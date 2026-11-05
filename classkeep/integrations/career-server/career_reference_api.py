"""Classkeep용 원문 발췌 API. 모델 호출이나 대화 이력 접근을 하지 않는다."""
from __future__ import annotations

import re
import threading
import time
import unicodedata
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit, quote_plus
from urllib.robotparser import RobotFileParser

import requests
from flask import jsonify, request
from job_assistant import (
    search_jobkorea_company, _parse_jobkorea_html, _html_descendants,
    _html_text, _parse_jobkorea_average_spec, _parse_jobkorea_essay_list,
)

ORIGIN = "https://www.jobkorea.co.kr"
AGENT = "Classkeep-Company-Search/1.0"
_slots = threading.BoundedSemaphore(2)


def normalize_company(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"주식회사|유한회사|\(주\)|\(유\)", "", value)
    return re.sub(r"\s+", "", value).strip()


def _key(value: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", normalize_company(value).lower())


def _page_url(value: str) -> bool:
    try:
        url = urlsplit(value)
        return (url.scheme == "https" and url.netloc == "www.jobkorea.co.kr"
                and not url.query and not url.fragment
                and bool(re.fullmatch(r"/company/\d{1,20}(?:/(?:Info|PassAssay|Review|PassAvgSpec))?/?", url.path, re.I)))
    except ValueError:
        return False


class PublicPages:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": AGENT})
        self.deadline = time.monotonic() + 85
        self.robots = RobotFileParser()
        response = self.session.get(ORIGIN + "/robots.txt", timeout=(3, 8), allow_redirects=False, stream=True)
        try:
            if response.status_code != 200:
                raise ValueError("자동 접근 규칙을 확인하지 못했습니다.")
            body = self._body(response, 128_000)
            if not re.search(r"^\s*User-agent\s*:", body, re.I | re.M):
                raise ValueError("자동 접근 규칙 형식을 확인하지 못했습니다.")
            self.robots.parse(body.splitlines())
        finally:
            response.close()

    def _body(self, response, limit=2 * 1024 * 1024) -> str:
        chunks, size = [], 0
        for chunk in response.iter_content(32_768):
            if time.monotonic() >= self.deadline:
                raise ValueError("조회 대기 시간을 초과했습니다.")
            size += len(chunk)
            if size > limit:
                raise ValueError("페이지 크기 제한을 초과했습니다.")
            chunks.append(chunk)
        encoding = response.encoding or "utf-8"
        if encoding.lower() == "iso-8859-1":
            encoding = "utf-8"
        return b"".join(chunks).decode(encoding, errors="replace")

    def can_read(self, url: str) -> bool:
        return self.robots.can_fetch(AGENT, url)

    def read(self, url: str) -> str:
        for _ in range(3):
            if not _page_url(url) or not self.can_read(url):
                raise ValueError("자동 접근이 제한된 페이지입니다.")
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError("조회 대기 시간을 초과했습니다.")
            response = self.session.get(url, timeout=(3, min(8, remaining)), allow_redirects=False, stream=True)
            try:
                if response.status_code in (301, 302, 303, 307, 308):
                    url = urljoin(url, response.headers.get("Location", ""))
                    if not _page_url(url):
                        raise ValueError("접속 확인 또는 제한 화면으로 이동했습니다.")
                    continue
                if response.status_code != 200:
                    raise ValueError("공개 페이지를 읽지 못했습니다.")
                if "text/html" not in response.headers.get("Content-Type", "").lower():
                    raise ValueError("HTML 페이지가 아닙니다.")
                page = self._body(response)
                if "해당기업이 존재하지 않습니다" in page:
                    raise ValueError("해당 기업 페이지가 없습니다.")
                return page
            finally:
                response.close()
        raise ValueError("페이지 이동 횟수를 초과했습니다.")

    def close(self):
        self.session.close()


def _check_identity(page: str, company: str) -> None:
    document = _parse_jobkorea_html(page)
    titles = _html_descendants(document, "title")
    title = _html_text(titles[0]) if titles else ""
    observed = re.split(r"\s+\d{4}년 기업정보|\s+기업정보|\s+합격자소서|\s+인적성|\s+면접|\s+합격\s*스펙", title)[0]
    if re.search(r"기업정보|합격|후기|자소서", title) and _key(observed) == _key(company):
        return
    # PassAvgSpec uses a generic document title. Verify the actual company banner,
    # never an arbitrary body mention or a related-company navigation link.
    generic_title = re.fullmatch(r"\s*합격\s*스펙\s*(?:\|\s*잡코리아)?\s*", title)
    if generic_title:
        for banner in _html_descendants(document, class_name="company-header-branding-body"):
            names = _html_descendants(banner, class_name="name")
            if any(_key(_html_text(node)) == _key(company) for node in names):
                return
    raise ValueError("기업명 일치 여부를 확인하지 못했습니다.")


def _profile_text(page: str) -> str:
    document = _parse_jobkorea_html(page)
    tables = _html_descendants(document, "table", "table-basic-infomation-primary")
    rows = []
    for table in tables:
        for row in _html_descendants(table, "tr"):
            labels = _html_descendants(row, "th")
            values = _html_descendants(row, "td")
            for label, value in zip(labels, values):
                name = _html_text(label)
                if name in {"산업", "주요사업", "홈페이지"}:
                    rows.append(name + ": " + _html_text(value)[:1000])
    return "\n".join(rows)


def _review_text(page: str) -> str:
    # Discard code/navigation; return a bounded extract of publicly visible experience text.
    # Review content itself may be wrapped in a search/filter form. Remove scripts
    # and navigation, but keep the visible content inside form tags.
    stripped = re.sub(r"<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?</\1>", " ", page, flags=re.I)
    body = re.search(r"<body\b[^>]*>([\s\S]*?)</body>", stripped, re.I)
    document = _parse_jobkorea_html(body.group(1) if body else stripped)
    text = _html_text(document)
    start = re.search(r"인적성[\s·ㆍ]*면접[\s·ㆍ]*합격\s*후기|인적성\s*후기|면접\s*후기", text)
    if not start:
        return ""
    text = text[start.start():]
    # A menu or a zero-result list is not a review.
    if not re.search(r"질문\s*[:：]|답변\s*[:：]|면접관|고사장|시험환경|질문은|합격통보", text[20:]):
        return ""
    return "지원자 후기 발췌(공식 채용요건이 아님): " + text[:5000]


def collect_company_references(company_name: str, *, lookup=None, pages=None):
    """Return independently collected page extracts. A missing spec never discards essays."""
    company = normalize_company(company_name)
    now = datetime.now(timezone.utc).isoformat()
    result = {"schema_version": 1, "company": company, "records": [], "warnings": [], "discovery_links": [], "retrieved_at": now}
    search_url = ORIGIN + "/Search/?stext=" + quote_plus(company)
    result["discovery_links"].append({"url": search_url, "company": company, "verified": False, "type": "search"})
    own_pages = pages is None
    try:
        pages = pages or PublicPages()
        if not all(pages.can_read(u) for u in [search_url, ORIGIN + "/Search/api/display/v1/companies"]):
            raise ValueError("기업 검색의 자동 접근이 제한되어 있습니다.")
        found = (lookup or search_jobkorea_company)(company, limit=5)
        candidates = [c for c in found.get("companies", []) if _key(str(c.get("company_name", ""))) == _key(company) and re.fullmatch(r"\d{1,20}", str(c.get("company_id", "")))]
        candidates = list({str(c["company_id"]): c for c in candidates}.values())
        if len(candidates) != 1:
            result["warnings"].append("이름이 같은 기업이 여러 곳입니다. 기업을 구체적으로 지정해주세요." if candidates else "일치하는 기업명과 기업 번호를 확인하지 못했습니다.")
            for candidate in candidates:
                result["discovery_links"].append({"url": ORIGIN + "/company/" + str(candidate["company_id"]), "company": candidate["company_name"], "verified": False, "type": "company"})
            return result
        actual = candidates[0]["company_name"]
        company_id = str(candidates[0]["company_id"])
        result.update({"company": actual, "company_id": company_id})
        base = ORIGIN + "/company/" + company_id
        blocked = False
        for kind, suffix in [("company-profile", ""), ("applicant-statistics", "/PassAvgSpec"), ("applicant-experience", "/PassAssay"), ("interview-experience", "/Review")]:
            url, verified = base + suffix, False
            try:
                if blocked:
                    continue
                page = pages.read(url)
                _check_identity(page, actual)
                if kind == "company-profile":
                    text = _profile_text(page)
                elif kind == "applicant-statistics":
                    data = _parse_jobkorea_average_spec(page)
                    if data.get("error") or not data.get("items"):
                        raise ValueError("평균 합격스펙을 읽지 못했습니다. 수치를 추정하지 않습니다.")
                    text = "지원자 표본 통계이며 공식 지원요건·가산점이 아닙니다.\n" + "\n".join(str(i.get("item", "")) + ": " + str(i.get("average", "")) + " / 보유율 " + str(i.get("holders", "")) for i in data["items"])
                    if data.get("statistics_updated_at"):
                        text += "\n통계 갱신일: " + data["statistics_updated_at"]
                elif suffix == "/PassAssay":
                    essays = _parse_jobkorea_essay_list(page, url, 3)
                    text = "\n\n".join(" / ".join(e.get(k, "") for k in ["period", "career_type", "job", "published_at"]) + "\n문항: " + e.get("question", "") + "\n목록 발췌: " + e.get("preview", "") for e in essays)
                    if text:
                        text = "합격자소서 목록의 공개 발췌입니다. 상세 원문 전체를 읽은 것이 아니며 공식 채용요건이 아닙니다.\n" + text
                else:
                    text = _review_text(page)
                if not text or len(text.strip()) < 30:
                    raise ValueError("읽을 수 있는 공개 본문이 없습니다.")
                result["records"].append({"title": actual + " / " + (suffix.lstrip("/") or "기업정보"), "company": actual, "url": url, "text": text[:6000], "kind": kind, "retrieval_method": "crawler-extract", "retrieved_at": now})
                verified = True
            except requests.RequestException:
                result["warnings"].append(actual + ": " + (suffix or "/") + " — 페이지 연결 실패")
            except ValueError as exc:
                result["warnings"].append(actual + ": " + (suffix or "/") + " — " + str(exc))
                if "제한" in str(exc) or "접속 확인" in str(exc):
                    blocked = True
            finally:
                result["discovery_links"].append({"url": url, "company": actual, "verified": verified, "type": "company"})
        return result
    except (requests.RequestException, ValueError):
        result["warnings"].append("기업 조회에 실패했습니다. 서버 연결·공개 접근 허용 여부를 확인해주세요.")
        return result
    finally:
        if own_pages and pages is not None:
            pages.close()


def register_career_reference_api(app, login_required, check_csrf):
    @app.post("/api/career/references")
    @login_required
    def career_references():
        if not check_csrf():
            return jsonify({"error": "요청 인증이 만료되었습니다."}), 400
        payload = request.get_json(silent=True)
        name = payload.get("company_name") if isinstance(payload, dict) else None
        if not isinstance(name, str) or not 2 <= len(name.strip()) <= 80 or re.search(r"[<>\x00-\x1f:/?]", name) or len(normalize_company(name)) < 2:
            return jsonify({"error": "기업명만 2~80자로 입력해주세요."}), 400
        if not _slots.acquire(blocking=False):
            return jsonify({"error": "기업 조회 중입니다. 잠시 후 다시 요청해주세요."}), 429
        try:
            return jsonify(collect_company_references(name))
        except Exception:
            # Exceptions must not expose API keys, cookies or full internal URLs.
            return jsonify({"error": "기업 원문 조회 처리에 실패했습니다."}), 502
        finally:
            _slots.release()
