"""Single, literal KEY=value settings file for every Python entry point."""
import os
import re
from pathlib import Path
from urllib.parse import urlsplit
ROOT = Path(__file__).resolve().parent
DEFAULT_SETTINGS = ROOT.parent / "프로그램설정.txt"

def parse_settings(text):
    values = {}
    for number, line in enumerate(text.lstrip("\ufeff").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not sep or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise ValueError(f"설정 {number}번째 줄: 항목=값 형식으로 입력해주세요.")
        if key in values:
            raise ValueError(f"설정 항목이 중복되었습니다: {key}")
        if value[:1] in ('\"', "'") and value:
            if len(value)<2 or value[-1]!=value[0]:
                raise ValueError(f"설정 따옴표를 확인해주세요: {key}")
            value=value[1:-1]
        values[key]=value
    return values

def settings_path():
    override=os.environ.get("CLASSKEEP_SETTINGS_FILE")
    return Path(override).resolve() if override else DEFAULT_SETTINGS

def load_settings(path=None):
    path=Path(path) if path else settings_path()
    try:
        values=parse_settings(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        raise ValueError("프로그램설정.txt 파일을 찾을 수 없습니다.") from None
    for key in ("HOST","PORT","PUBLIC_URL","DATABASE_DRIVER","OLLAMA_BASE_URL","OLLAMA_MODEL","SESSION_SECRET","TOKEN_KEY","DEMO_PASSCODE"):
        if not values.get(key):
            raise ValueError(f"프로그램설정.txt에 {key} 값을 입력해주세요.")
    for key in ("PUBLIC_URL","OLLAMA_BASE_URL","WORK24_BASE_URL"):
        url=urlsplit(values.get(key,""))
        if url.scheme not in ("http","https") or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError(f"{key}: http:// 또는 https:// 주소를 확인해주세요.")
        if key=="OLLAMA_BASE_URL" and url.path.rstrip("/").endswith(("/api/chat","/api/generate")):
            raise ValueError("OLLAMA_BASE_URL에는 /api/chat 없이 서버 주소와 포트만 입력해주세요.")
    for key in ("PORT","MYSQL_PORT","OLLAMA_TIMEOUT","OLLAMA_TIMEOUT_MS","OLLAMA_NUM_CTX","HTTP_TIMEOUT","CAREER_LOOKUP_TIMEOUT_MS","APP_PORT","APP_THREADS"):
        if key in values and (not values[key].isdigit() or int(values[key])<1):
            raise ValueError(f"{key}: 1 이상의 숫자를 입력해주세요.")
    for key in ("PORT","MYSQL_PORT","APP_PORT"):
        if int(values.get(key,"1"))>65535:raise ValueError(f"{key}: 포트는 65535 이하여야 합니다.")
    if values["DATABASE_DRIVER"] not in ("mysql","postgres"):
        raise ValueError("DATABASE_DRIVER는 mysql 또는 postgres입니다.")
    required=("MYSQL_HOST","MYSQL_USER","MYSQL_DATABASE") if values["DATABASE_DRIVER"]=="mysql" else ("DATABASE_URL",)
    for key in required:
        if not values.get(key):raise ValueError(f"DB 설정을 입력해주세요: {key}")
    if len(values["SESSION_SECRET"])<32 or not re.fullmatch(r"[0-9a-fA-F]{64}",values["TOKEN_KEY"]) or len(values["DEMO_PASSCODE"])<12:
        raise ValueError("SESSION_SECRET(32자 이상), TOKEN_KEY(64자리 HEX), DEMO_PASSCODE(12자 이상)를 확인해주세요.")
    for key in ("DATA_DIR","ELURI_SCRIPT_PATH","ELURI_PYTHON","ELURI_PROFILE_DIR"):
        if values.get(key):
            p=Path(values[key]);values[key]=str(p if p.is_absolute() else ROOT/p)
    return values

def apply_settings():
    values=load_settings()
    os.environ.update(values)
    os.environ["PYTHON_DOTENV_DISABLED"]="1"
    os.environ["PYTHONDONTWRITEBYTECODE"]="1"
    return values
