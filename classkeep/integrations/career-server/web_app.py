"""LAN에서 공유할 수 있는 Flask 웹 UI. API 키는 서버의 프로그램설정.txt에서만 읽는다."""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from flask import Flask, Response, jsonify, render_template, request, session
from waitress import serve

from job_assistant import (
    OLLAMA_NUM_CTX,
    OLLAMA_TIMEOUT,
    OLLAMA_MODEL,
    SYSTEM_PROMPT,
    _strip_tool_call_traces,
    chat_turn,
)
from career_reference_api import register_career_reference_api
from study_chat_api import register_study_chat_api


# Shared settings are loaded by job_assistant.

APP_PORT = int(os.getenv("APP_PORT", "8000"))
APP_THREADS = max(2, min(int(os.getenv("APP_THREADS", "8")), 32))
FLASK_SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "")

app = Flask(__name__)
app.config.update(
    SECRET_KEY=FLASK_SECRET_KEY or secrets.token_hex(32),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=False,  # LAN HTTP 예제. HTTPS 종단을 추가하면 True로 설정.
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
    MAX_CONTENT_LENGTH=256 * 1024,
)

_chats: dict[str, dict[str, Any]] = {}
_chats_lock = threading.Lock()
_external_chats: dict[str, dict[str, Any]] = {}
_external_chats_lock = threading.Lock()
_external_rate_limits: dict[str, list[float]] = {}
_external_rate_lock = threading.Lock()
_chat_ttl_seconds = 12 * 60 * 60
_max_chat_sessions = 200
_external_requests_per_minute = 30


def _check_csrf() -> bool:
    return True


def _public_route(view: Callable[..., Any]) -> Callable[..., Any]:
    return view


def _external_rate_limited() -> bool:
    now = time.time()
    client_key = request.remote_addr or "unknown"
    with _external_rate_lock:
        recent = [stamp for stamp in _external_rate_limits.get(client_key, []) if now - stamp < 60]
        if len(recent) >= _external_requests_per_minute:
            _external_rate_limits[client_key] = recent
            return True
        recent.append(now)
        _external_rate_limits[client_key] = recent
        return False


def _external_chat_entry(conversation_id: str) -> dict[str, Any]:
    now = time.time()
    with _external_chats_lock:
        expired = [
            key for key, entry in _external_chats.items()
            if now - entry["updated_at"] > _chat_ttl_seconds
        ]
        for key in expired:
            _external_chats.pop(key, None)
        if conversation_id not in _external_chats:
            if len(_external_chats) >= _max_chat_sessions:
                oldest = min(_external_chats, key=lambda key: _external_chats[key]["updated_at"])
                _external_chats.pop(oldest, None)
            _external_chats[conversation_id] = {
                "history": [{"role": "system", "content": SYSTEM_PROMPT}],
                "state": {},
                "updated_at": now,
                "lock": threading.Lock(),
            }
        entry = _external_chats[conversation_id]
        entry["updated_at"] = now
        return entry


def _chat_entry() -> dict[str, Any]:
    chat_id = session.get("chat_id")
    now = time.time()
    with _chats_lock:
        expired = [
            key for key, entry in _chats.items()
            if now - entry["updated_at"] > _chat_ttl_seconds
        ]
        for key in expired:
            _chats.pop(key, None)

        if not chat_id or chat_id not in _chats:
            chat_id = uuid.uuid4().hex
            session["chat_id"] = chat_id
            session.modified = True
            if len(_chats) >= _max_chat_sessions:
                oldest = min(_chats, key=lambda key: _chats[key]["updated_at"])
                _chats.pop(oldest, None)
            _chats[chat_id] = {
                "history": [{"role": "system", "content": SYSTEM_PROMPT}],
                "state": {},
                "updated_at": now,
                "lock": threading.Lock(),
            }
        entry = _chats[chat_id]
        entry["updated_at"] = now
        return entry


@app.after_request
def _security_headers(response: Any) -> Any:
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.path.startswith("/api/"):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        response.headers["Access-Control-Max-Age"] = "600"
    return response


@app.get("/")
def index() -> str:
    return render_template(
        "index.html",
        model=OLLAMA_MODEL,
    )


def _external_api_error(message: str, status: int) -> tuple[Any, int]:
    return jsonify({"error": message}), status


def _check_external_api_access() -> tuple[Any, int] | None:
    if _external_rate_limited():
        return _external_api_error("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
    return None


@app.route("/api/tags", methods=["GET", "OPTIONS"])
def api_ollama_tags() -> Any:
    if request.method == "OPTIONS":
        return Response(status=204)
    access_error = _check_external_api_access()
    if access_error:
        return access_error
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return jsonify(
        {
            "models": [
                {
                    "name": OLLAMA_MODEL,
                    "model": OLLAMA_MODEL,
                    "modified_at": now,
                    "size": 0,
                    "digest": "",
                    "details": {
                        "format": "chat-assistant-api",
                        "family": "work24-job-assistant",
                        "families": ["work24-job-assistant"],
                        "parameter_size": "configured",
                        "quantization_level": "N/A",
                    },
                }
            ]
        }
    )


@app.get("/api/version")
def api_ollama_version() -> Any:
    return jsonify({"version": "0.1.0", "capabilities": ["classkeep-study-v1"]})


def _ollama_compatible_chat(payload: dict[str, Any]) -> Any:
    access_error = _check_external_api_access()
    if access_error:
        return access_error

    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages or len(messages) > 80:
        return _external_api_error("messages는 1~80개의 메시지 배열이어야 합니다.", 400)
    if not isinstance(messages[-1], dict) or messages[-1].get("role") != "user":
        return _external_api_error("messages의 마지막 항목은 user 메시지여야 합니다.", 400)
    user_text = messages[-1].get("content")
    if not isinstance(user_text, str) or not user_text.strip():
        return _external_api_error("마지막 user 메시지의 content를 입력해 주세요.", 400)
    user_text = user_text.strip()
    if len(user_text) > 2000:
        return _external_api_error("한 번에 2,000자까지 입력할 수 있습니다.", 413)

    conversation_id = payload.get("conversation_id") or uuid.uuid4().hex
    if not isinstance(conversation_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", conversation_id):
        return _external_api_error("conversation_id는 영문, 숫자, 하이픈, 밑줄로 1~80자여야 합니다.", 400)

    context_messages: list[dict[str, str]] = []
    context_size = 0
    for message in messages[:-1]:
        if not isinstance(message, dict) or message.get("role") not in {"user", "assistant"}:
            continue
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        if message["role"] == "assistant":
            content = _strip_tool_call_traces(content)
        if not content:
            continue
        context_size += len(content)
        if context_size > 40000:
            return _external_api_error("대화 이력이 너무 깁니다. 40,000자 이내로 보내주세요.", 413)
        context_messages.append({"role": message["role"], "content": content})

    entry = _external_chat_entry(conversation_id)
    try:
        with entry["lock"]:
            if context_messages:
                entry["history"] = [{"role": "system", "content": SYSTEM_PROMPT}, *context_messages]
            answer = chat_turn(entry["history"], user_text, entry["state"])
            entry["updated_at"] = time.time()
    except Exception:
        return _external_api_error("챗봇 응답을 생성하지 못했습니다. 서버 로그를 확인해 주세요.", 502)

    result = {
        "model": OLLAMA_MODEL,
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "message": {"role": "assistant", "content": _strip_tool_call_traces(answer)},
        "done": True,
        "done_reason": "stop",
        "conversation_id": conversation_id,
    }
    if payload.get("stream", True):
        return Response(json.dumps(result, ensure_ascii=False) + "\n", mimetype="application/x-ndjson")
    return jsonify(result)


@app.get("/api/history")
def api_history() -> Any:
    entry = _chat_entry()
    with entry["lock"]:
        visible = []
        for message in entry["history"]:
            role = message.get("role")
            content = message.get("content", "")
            if role not in {"user", "assistant"} or message.get("tool_calls"):
                continue
            if role == "assistant":
                content = _strip_tool_call_traces(str(content))
            if role == "user" and content.startswith("도구 조회를 마쳤습니다. 원래 요청은:"):
                continue
            if content:
                visible.append({"role": role, "content": content})
        return jsonify({"messages": visible[-60:]})


@app.route("/api/chat", methods=["POST", "OPTIONS"])
def api_chat() -> Any:
    if request.method == "OPTIONS":
        return Response(status=204)
    payload = request.get_json(silent=True) or {}
    if "messages" in payload:
        return _ollama_compatible_chat(payload)
    if _external_rate_limited():
        return _external_api_error("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
    user_text = payload.get("message", "")
    if not isinstance(user_text, str) or not user_text.strip():
        return jsonify({"error": "메시지를 입력해 주세요."}), 400
    user_text = user_text.strip()
    if len(user_text) > 2000:
        return jsonify({"error": "한 번에 2,000자까지 입력할 수 있습니다."}), 413

    entry = _chat_entry()
    try:
        with entry["lock"]:
            answer = chat_turn(entry["history"], user_text, entry["state"])
            entry["updated_at"] = time.time()
        return jsonify({"reply": answer})
    except Exception as exc:
        return jsonify({"error": f"응답 생성 중 오류가 발생했습니다: {exc}"}), 502


register_study_chat_api(app, _check_external_api_access)
register_career_reference_api(app, _public_route, _check_csrf)


def main() -> int:
    print(f"웹 채팅 서버 시작: http://0.0.0.0:{APP_PORT}")
    print(f"다른 사이트 연결용 Base URL: http://<서버IP>:{APP_PORT}")
    print(f"모델: {OLLAMA_MODEL} / Ollama 응답 대기: {OLLAMA_TIMEOUT}초 / 컨텍스트: {OLLAMA_NUM_CTX}")
    print("로그인 없이 웹 채팅과 Ollama 호환 API를 사용할 수 있습니다.")
    print("같은 네트워크의 팀원은 이 컴퓨터의 LAN IP와 포트로 접속하면 됩니다.")
    serve(app, host="0.0.0.0", port=APP_PORT, threads=APP_THREADS)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
