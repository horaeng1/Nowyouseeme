## 로컬 파이프라인 연결 가이드

Google Drive를 사용하지 않고, 로컬 저장소만으로 업로드 → 처리 → 다운로드 흐름을 구성하는 방법입니다. 현재 파이프라인은 임시로 “원본 mp4를 그대로 복사(또는 변환 스크립트로 대체)”하는 수준이며, 추후 실제 AD 생성 모듈을 연결할 수 있습니다.

### 1. 구성 요소

1. **프런트엔드 (`web-ads-app`)**
   - `/api/upload`로 mp4 업로드
   - 반환된 Job ID를 폴링해 상태 표시 및 다운로드 링크 노출

2. **백엔드 (`server`)**
   - Multer로 mp4 수신 후 `server/storage/uploads` 폴더에 저장
   - Job 정보를 `server/data/jobs.json`에 기록
   - 정적 파일 제공: `http://localhost:4000/files/uploads/...`
   - 파이프라인용 API
     - `GET /api/jobs/next` : 가장 오래된 `queued` 작업 반환
     - `POST /api/jobs/:id/progress` : 상태 업데이트
     - `POST /api/jobs/:id/result` : 결과 파일 정보 등록
     - `POST /api/jobs/:id/fail` : 실패 처리

3. **로컬 파이프라인 스크립트 (`server/scripts/localProcessor.js`)**
   - 백엔드 API를 호출해 대기 작업을 가져온 뒤
   - 업로드된 파일을 다운로드(HTTP) → `server/storage/results`에 복사
   - 결과 경로를 서버에 보고 (현재는 단순 복사, 필요시 ffmpeg 로직으로 교체)

### 2. 환경 설정

1. 백엔드 `.env` 작성 (`server/env.sample` 참고)
   ```
   PORT=4000
   CLIENT_ORIGIN=http://localhost:5173
   API_BASE_URL=http://localhost:4000/api   # localProcessor에서 사용
   SERVER_BASE_URL=http://localhost:4000    # 파일 다운로드용 (선택)
   ```
2. `server/storage/uploads`, `server/storage/results` 폴더는 서버가 자동 생성합니다.

### 3. 실행 순서

1. 백엔드
   ```
   cd server
   npm install
   npm run dev
   ```
2. 프런트엔드
   ```
   cd web-ads-app
   npm install
   npm run dev
   ```
3. 로컬 파이프라인
   ```
   cd server
   # Python(>=3.9)과 moviepy 설치
   pip install moviepy

   # 환경 변수 (선택)
   # set PYTHON_BIN=python3
   # set PROCESSOR_SCRIPT=C:\path\to\custom_script.py

   node scripts/localProcessor.js
   ```
   - 첫 실행 시 `scripts/resize_480p.py`가 moviepy로 480p 변환을 수행합니다.
   - 다른 변환 로직을 쓰고 싶다면 PROCESSOR_SCRIPT 환경변수로 별도 경로를 지정하세요.

### 4. 데이터 흐름

1. 사용자가 mp4 업로드 → 서버 `storage/uploads`에 저장
2. Job 메타데이터가 큐에 기록되고 프런트는 상태를 폴링
3. `localProcessor`가 `/api/jobs/next`로 작업 조회
4. 업로드 파일을 HTTP로 받아 `storage/results`에 복사(또는 변환)
5. `/api/jobs/:id/result`에 결과 파일 경로를 보고
6. 프런트에서 결과 다운로드 버튼 활성화

### 5. 확장 아이디어

- `localProcessor` 내에서 `ffmpeg` 또는 Python 스크립트를 호출해 480p 변환/AD 삽입 로직을 실제로 구현
- 여러 작업을 순차/병렬로 처리하도록 워커 스케줄러 도입
- 파일 정리: 일정 시간 후 `uploads`/`results` 폴더를 청소하는 CRON 추가
- 나중에 클라우드로 이전 시, 현재 API 구조를 그대로 유지하고 저장소만 S3/GCS 등으로 교체 가능

