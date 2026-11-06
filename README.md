# Backend refresh patch (Express + Neon + Vercel)

이 ZIP은 기존 게임의 `public/` 및 `db/schema.sql`을 덮어쓰지 않는 서버 교체 패치입니다.

## 적용 방법
1. 현재 프로젝트의 `server.js`를 백업합니다.
2. ZIP의 `server.js`, `package.json`, `vercel.json`, `db-check.mjs`, `guest-check.mjs`를 기존 프로젝트 최상위(`server.js`, `package.json`이 있는 폴더)에 복사합니다.
3. 기존 `package-lock.json`을 삭제하지 말고 아래를 실행합니다.
   ```powershell
   npm.cmd install
   npm.cmd run check
   ```
4. `.env`는 그대로 유지합니다. `DATABASE_URL`, `JWT_SECRET`, `PORT=3000`을 확인합니다.
5. 로컬 서버 실행:
   ```powershell
   npm.cmd run dev
   ```
6. 새 터미널에서:
   ```powershell
   node .\db-check.mjs
   node .\guest-check.mjs
   ```

## Vercel 구성
- Git 저장소의 프로젝트 루트에 `server.js`, `package.json`, `public/`가 함께 있어야 합니다.
- Vercel Root Directory는 이 파일들이 직접 들어 있는 폴더로 지정합니다.
- Framework Preset은 Express(또는 자동 감지)로 둡니다.
- Build Command / Output Directory Override는 끕니다.
- Vercel 환경변수에 `DATABASE_URL`, `JWT_SECRET`을 Production에 등록하고 새 배포를 만듭니다.
- `public/` 정적 파일은 Vercel CDN에서 제공됩니다. Express의 `express.static()`은 로컬에서만 사용합니다.
- 루트에 기존 `index.js`와 새 `server.js`가 둘 다 Express 앱으로 남아 있으면 자동 감지 혼란을 피하도록 이전 `index.js`는 프로젝트 루트 밖으로 백업 이동하세요. 최상위 진입점은 `server.js` 하나만 두세요.

기존 `.env`는 절대로 Git에 올리지 마세요.
