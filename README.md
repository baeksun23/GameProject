# 직업 대전: Express.js + Neon + Vercel

기존 HTML5 격투 게임의 캐릭터, 전투, CPU/로컬 대전은 유지하고 온라인 백엔드를 Firebase에서 Express.js + Neon PostgreSQL로 전환한 시작 프로젝트입니다.

## 구성

- `public/`: 브라우저 게임 파일
- `index.js`: Express API 서버 (Vercel에서는 Express Function으로 실행)
- `db/schema.sql`: Neon에 생성할 PostgreSQL 테이블
- `DATABASE_URL`: Neon 연결 문자열 (서버 환경변수)
- `JWT_SECRET`: 게스트 계정 인증용 서버 비밀키

온라인 기능 흐름:
1. Express가 게스트 플레이어 토큰을 발급합니다.
2. Neon이 플레이어 전적, 대전방, WebRTC offer/answer/ICE 후보를 저장합니다.
3. 클라이언트는 대전 연결이 성립할 때까지만 API를 짧게 폴링합니다.
4. 연결 후 실제 게임 입력/상태는 WebRTC DataChannel로 두 브라우저가 직접 주고받습니다.

Firebase SDK, Firebase Auth, Firestore는 사용하지 않습니다.

## 1. Neon 데이터베이스 만들기

1. https://neon.com 에 로그인하고 프로젝트를 만듭니다.
2. Neon 프로젝트의 **SQL Editor**를 엽니다.
3. `db/schema.sql` 파일 전체를 붙여넣고 실행합니다.
4. **Connect** 메뉴에서 앱의 연결 문자열을 복사합니다.
5. 가능하면 호스트명에 `-pooler`가 포함된 pooled connection string을 사용합니다.
6. 연결 문자열은 비밀 정보이므로 프론트엔드 파일이나 채팅에 붙여넣지 마세요.

## 2. 로컬 환경변수 준비

프로젝트 최상위 폴더에서 `.env.example`을 복사해 `.env` 파일을 만듭니다.

`.env` 예시:

```dotenv
DATABASE_URL="Neon에서 복사한 실제 연결 문자열"
JWT_SECRET="길고 임의적인 비밀 문자열 32자 이상"
PORT=3000
```

JWT_SECRET은 PowerShell에서 아래 명령으로 만들 수 있습니다.

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

출력된 값을 `.env`의 JWT_SECRET에 넣으세요. `.env`는 `.gitignore`에 포함되어 있어 배포 파일에 올리지 않아야 합니다.

## 3. Visual Studio Code에서 실행

VS Code에서 `job-fighter-express-neon` 폴더 자체를 엽니다. 터미널에서 아래 명령을 실행합니다.

PowerShell 실행 정책으로 `npm`이 막히면 명령 앞에 `.cmd`를 사용하세요.

```powershell
npm.cmd install
npm.cmd run dev
```

브라우저에서 `http://localhost:3000`을 열면 게임이 나옵니다.

데이터베이스 연결을 확인하려면 새 탭에서 다음 주소를 엽니다.

`http://localhost:3000/api/health`

정상 예시:

```json
{"ok":true,"database":"connected","serverTime":"..."}
```

## 4. Vercel에 GitHub 없이 배포

1. Vercel CLI가 설치되어 있지 않다면:

```powershell
npm.cmd install -g vercel
```

2. 로그인하고 프로젝트 루트에서 배포합니다.

```powershell
vercel.cmd login
vercel.cmd
```

3. 질문에 답하고 Preview 배포를 완료합니다.
4. Vercel 프로젝트의 **Settings → Environment Variables**에서 다음 두 변수를 추가합니다. 값 유형은 Secret으로 선택하고, 우선 Production에 추가합니다. Preview에서도 시험할 계획이면 Preview에도 같은 변수를 추가합니다.
   - `DATABASE_URL`: Neon pooled connection string
   - `JWT_SECRET`: 로컬에서 생성한 비밀 문자열
   또는 프로젝트를 CLI로 연결한 뒤 `vercel env add DATABASE_URL production`과 `vercel env add JWT_SECRET production`을 차례로 실행해도 됩니다.
5. 환경변수를 저장한 후 정식 배포합니다.

```powershell
vercel.cmd --prod
```

이 프로젝트는 `index.js`에서 Express 앱을 기본 export하므로 Vercel의 Express 감지를 사용합니다. 정적 파일은 `public/` 폴더에서 제공됩니다. 별도의 `Output Directory=public` 설정을 강제로 지정하지 마세요.

## 5. 온라인 대전 시험

1. 서로 다른 브라우저/기기에서 배포 주소를 엽니다.
2. A에서 **ONLINE PVP: HOST**를 눌러 6자리 방 코드를 확인합니다.
3. B에서 **ONLINE PVP: JOIN**을 눌러 방 코드를 입력합니다.
4. 두 플레이어가 캐릭터를 선택하면 대전이 시작됩니다.

## 6. 현재 구현 범위와 주의사항

- 첫 버전은 비밀번호 없는 게스트 계정입니다. 토큰은 해당 브라우저의 localStorage에 저장됩니다. 브라우저 데이터를 삭제하면 게스트 계정을 복구할 수 없습니다.
- 온라인 방은 30분 후 만료됩니다.
- WebRTC 연결 협상 정보만 Express/Neon을 통해 전달합니다. 게임 중 입력/상태는 기존처럼 P2P DataChannel을 사용합니다.
- STUN 서버만 설정되어 있어 일부 공유기/회사/학교 네트워크에서는 TURN 서버가 추가로 필요할 수 있습니다.
- 현재 전투 결과는 클라이언트가 보고합니다. 랭킹 조작을 막는 서버 권위형 판정은 아직 아닙니다.
- 공개 서비스 전에는 rate limit, 닉네임 변경 검증, 토큰 갱신/계정 연동, 방 재접속, 오래된 방/시그널 정리 작업을 추가하세요.
- Neon 연결 문자열과 JWT_SECRET은 절대 `public/` 안에 두거나 브라우저 코드에 넣지 마세요.

## 문제 해결

- `DATABASE_URL 환경변수가 설정되지 않았습니다`: `.env` 파일이 프로젝트 최상위 폴더에 있는지 확인하세요.
- `relation ... does not exist`: Neon SQL Editor에서 `db/schema.sql`을 실행하세요.
- `/api/health`가 503: DATABASE_URL 값과 Neon 프로젝트 상태를 확인하세요.
- 401 인증 오류: 브라우저 localStorage의 `jobfighter_token`이 만료/오염되었을 수 있습니다. 개발자 도구에서 해당 키를 삭제하고 새로고침해 게스트 계정을 다시 만드세요.
- WebRTC 연결 실패: 두 브라우저의 콘솔을 확인하고 TURN 서버가 필요한 네트워크인지 점검하세요.
