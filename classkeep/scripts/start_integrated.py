"""Run both services using the single user settings file."""
import os
import subprocess
import sys
import threading
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from runtime_settings import apply_settings, settings_path

def main():
    try:
        settings=apply_settings()
    except (ValueError,OSError) as error:
        print("설정 오류:",error)
        return 1
    if "--check-config" in sys.argv:
        print("프로그램설정.txt 읽기 완료")
        print("DB 종류:",settings["DATABASE_DRIVER"],"/ AI 모델:",settings["OLLAMA_MODEL"])
        print("고용24 서비스별 키:",sum(bool(v) for k,v in settings.items() if k.startswith("WORK24_AUTH_KEY_")))
        if settings.get("ELURI_SCRIPT_PATH") and not Path(settings["ELURI_SCRIPT_PATH"]).is_file():
            print("이루리 수집기 경로가 현재 PC에 없습니다. 설정 파일에서 경로를 수정해주세요.")
        return 0
    try:
        from waitress import create_server
        sys.path.insert(0,str(root/"integrations"/"career-server"))
        from web_app import app
    except ImportError:
        print("Python 실행 패키지가 없습니다. SETUP-SERVER.cmd를 실행해주세요.")
        return 1
    http=create_server(app,host="127.0.0.1",port=0,threads=int(settings.get("APP_THREADS","8")))
    threading.Thread(target=http.run,daemon=True).start()
    node_env=os.environ.copy()
    node_env["CLASSKEEP_SETTINGS_FILE"]=str(settings_path())
    node_env["CLASSKEEP_GATEWAY_URL"]="http://127.0.0.1:"+str(http.effective_port)
    child=None
    try:
        child=subprocess.Popen(["node","server/index.js"],cwd=root,env=node_env)
        return child.wait()
    except FileNotFoundError:
        print("Node.js 실행 파일을 찾을 수 없습니다. Node.js 22 이상을 설치해주세요.")
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:child.kill()
        http.close()

if __name__=="__main__":
    sys.exit(main())
