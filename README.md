# GameProject Vercel 404 보완 패치

이 패치는 기존 게임 파일과 Neon 스키마를 보존하고, 배포 시 루트 페이지가 Express 404에 빠지는 경우를 보완합니다.

## 포함 파일
- `server.js`: `/`와 `/index.html`에 명시적인 HTML 반환 경로 추가
- `vercel.json`: Express Function에 `public/**` 파일을 포함하도록 설정
- `.gitignore`: `.env`, `node_modules`, `.vercel` 등 제외
- `package-lock.json`: `package.json`과 루트 패키지 이름/버전 동기화

## 적용
1. 기존 프로젝트 폴더에 이 ZIP의 파일을 덮어씁니다. `server.js`, `package-lock.json`, `vercel.json`은 교체하고 `.gitignore`는 추가합니다.
2. 기존 `public/index.html`, `db/schema.sql`, `.env`는 그대로 둡니다. 이 ZIP에는 보안상 `.env`가 들어 있지 않습니다.
3. 터미널에서 `npm.cmd install`을 실행하고 `npm.cmd run check`를 실행합니다.
4. GitHub에 커밋/푸시하고 Vercel에서 새 배포가 성공했는지 확인합니다.

## Vercel 설정
- Root Directory: `server.js`, `package.json`, `public/`가 함께 있는 프로젝트 폴더
- Framework Preset: Express (또는 자동 감지)
- Build Command / Output Directory: 별도 Override를 사용하지 않음
- Production Environment Variables: `DATABASE_URL`, `JWT_SECRET` 등록

## 보안 주의
`.env` 또는 `node_modules/`가 이미 Git에 추적되고 있다면 `.gitignore`만 추가해도 Git 추적은 해제되지 않습니다. 실제로 추적 중인 경우에만 아래 명령으로 Git 인덱스에서 제거한 뒤 커밋하세요. 로컬 파일은 삭제되지 않습니다.

```powershell
git rm --cached .env
git rm -r --cached node_modules
```

`.env`가 공개 저장소에 올라간 적이 있다면 Neon 데이터베이스 비밀번호를 교체하고 `JWT_SECRET`도 새 값으로 바꾸세요.
