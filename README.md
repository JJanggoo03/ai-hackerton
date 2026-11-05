1. 설정열기.cmd를 실행해 프로그램설정.txt를 메모장으로 엽니다.
2. AI 주소/모델, DB 주소/계정/비밀번호, GitHub, 고용24 키, 이루리 수집기 경로를 수정하고 저장합니다.
3. 서버가 켜져 있다면 해당 서버 창에서 Ctrl+C로 종료한 뒤 시작.cmd를 실행합니다.
   설정은 실행 시 한 번 읽으므로 파일을 저장하는 것만으로 실행 중인 서버가 바뀌지는 않습니다.
4. 처음 사용하는 PC는 Node.js 22 이상과 Python을 설치하고 설치.cmd를 먼저 실행합니다.

어디를 수정하나요?
- OLLAMA_BASE_URL: 실제 Ollama 서버. 예: http://127.0.0.1:11434 (모델 서버에 해당 모델 설치 필요)
- OLLAMA_MODEL: 사용할 모델명
- MYSQL_HOST: DB 서버 IP. 사용자의 외부 IP가 아닙니다.
- MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE: DB 접속값
- PUBLIC_URL: 사용자가 브라우저에서 접속하는 사이트 주소
- GitHub 앱 Callback URL: PUBLIC_URL 뒤에 /github/callback
- WORK24_AUTH_KEY_*: 고용24 서비스별 인증키
- ELURI_SCRIPT_PATH: 이루리 수집 Python 프로그램 경로. 다른 PC에서는 이 파일도 별도로 준비해야 합니다.
- DATA_DIR, ELURI_PROFILE_DIR: 상대 경로는 classkeep 폴더를 기준으로 합니다.

운영 데이터
- data/blobs의 업로드 파일과 MySQL 데이터는 정리 대상이 아닙니다.
- TOKEN_KEY는 DB에 암호화된 GitHub 연결을 읽는 키입니다. 기존 DB를 사용할 때 함부로 바꾸지 마세요.
- MySQL 원격 접속 허용 IP 변경은 DB 서버에서 별도로 처리해야 합니다.
- 새 대화 기록과 사용자 데이터는 현재 서버 코드가 사용 중인 DB에 계속 저장됩니다.

개발/확인
- classkeep에서 npm run config:check: 비밀번호를 출력하지 않고 설정 형식을 확인합니다.
- npm start도 같은 통합 서버를 실행합니다. 새 가상환경이 있으면 자동으로 사용하고, 없으면 시스템 Python을 사용합니다.
- 기존 .env는 새 실행에서 읽지 않습니다. 프로그램설정.txt 한 곳만 수정하세요.
