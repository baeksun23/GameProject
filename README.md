# 직업 대전: NEON CITY REMASTERED

Visual Studio Code에서 개발하고 Firebase Hosting으로 공개할 수 있는 HTML5 격투 게임 프로젝트입니다.
기존 게임의 18개 직업, 캔버스 렌더링, CPU/로컬 대전 및 Firebase + WebRTC 온라인 대전 코드를 유지합니다.

## 1. Visual Studio Code에서 열기

1. ZIP 압축을 풉니다.
2. Visual Studio Code를 실행하고 **파일 → 폴더 열기**에서 `job-fighter-online-start` 폴더를 선택합니다.
3. 확장 프로그램 탭에서 권장 확장인 **Live Server**를 설치합니다. (오른쪽 아래에 설치 안내가 뜨면 설치해도 됩니다.)
4. `public/index.html` 파일을 엽니다.
5. 편집기 오른쪽 아래의 **Go Live**를 누릅니다.
6. 브라우저에서 게임 메뉴가 뜨는지 확인합니다.

> `index.html`을 파일 탐색기에서 더블클릭하는 방식(`file://`) 대신 Live Server로 실행하세요. JavaScript ES Module과 Firebase SDK를 사용합니다.

## 2. 먼저 로컬 대전 확인

Firebase를 연결하기 전에도 메인 메뉴와 CPU/같은 컴퓨터 2인 대전을 확인할 수 있습니다.

- `LOCAL MULTIPLAYER / CPU`: 캐릭터 선택 화면
- `MODE: CPU BATTLE`: CPU 대전과 로컬 2인 대전 전환
- P1: A/D 이동, W 점프, S 가드, J 약공격, K 강공격, L 스킬
- P2: 방향키 이동/점프/가드, 숫자패드 1/2/3 공격 및 스킬
- 방향키 또는 A/D 방향을 빠르게 두 번 누르면 대시
- ESC: 일시정지

## 3. Firebase 온라인 기능 연결

온라인 방 생성/참가와 온라인 전적은 본인의 Firebase 프로젝트가 있어야 작동합니다.

### 3-1. Firebase 프로젝트 만들기

1. [Firebase Console](https://console.firebase.google.com/)에서 프로젝트를 생성합니다.
2. 프로젝트 개요에서 웹 앱(</>)을 추가합니다.
3. 앱 등록 화면에서 제공하는 Firebase 구성 객체를 복사해 둡니다.
4. **Authentication → Sign-in method**에서 **Anonymous(익명)** 로그인을 사용 설정합니다.
5. **Firestore Database**에서 데이터베이스를 생성합니다.

### 3-2. 웹 앱 설정 입력

`public/firebase-config.js`를 열고 아래 예시를 실제 Firebase 콘솔 값으로 교체합니다.

```js
export const firebaseConfig = {
  apiKey: "Firebase 콘솔의 apiKey",
  authDomain: "Firebase 콘솔의 authDomain",
  projectId: "Firebase 콘솔의 projectId",
  storageBucket: "Firebase 콘솔의 storageBucket",
  messagingSenderId: "Firebase 콘솔의 messagingSenderId",
  appId: "Firebase 콘솔의 appId"
};
```

필드 이름과 값은 콘솔에 표시된 것을 그대로 사용하세요. `storageBucket` 주소 형식 등을 임의로 만들지 마세요.
웹 설정 값은 브라우저에 노출되는 공개 클라이언트 설정입니다. 관리자 서비스 계정 키나 비밀번호를 이 파일에 넣으면 안 됩니다.

### 3-3. Firestore 규칙 게시

프로젝트 루트의 `firestore.rules`는 개발/2인 접속 테스트를 위한 규칙입니다. Firebase Console의 **Firestore Database → Rules**에 내용을 붙여 넣고 게시하거나, Firebase CLI로 배포할 수 있습니다.

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules
```

**보안 주의:** 현재 방 규칙은 로그인한 사용자가 방 문서를 읽고 쓸 수 있게 합니다. 방 코드가 알려진 경우 다른 로그인 사용자도 방 데이터에 접근할 수 있으므로 공개 서비스 운영 규칙으로 사용하지 마세요. 정식 서비스 전에는 방 소유자/참가자 UID 검증, 방 만료, 필드 검증, 전적 조작 방지 등을 구현해야 합니다.

## 4. 온라인 대전 시험

1. 서로 다른 두 기기(또는 같은 PC의 서로 다른 브라우저/시크릿 프로필)에서 같은 게임 주소를 엽니다.
2. 두 기기 모두 Firebase 설정이 반영된 동일한 빌드를 사용합니다.
3. 기기 A에서 **ONLINE PVP: HOST**를 눌러 6자리 방 코드를 확인합니다.
4. 기기 B에서 **ONLINE PVP: JOIN**을 눌러 방 코드를 입력합니다.
5. 두 플레이어가 캐릭터를 선택하면 대전이 시작됩니다.

온라인 접속이 안 되면 브라우저 개발자 도구(F12)의 **Console**에서 Firebase 인증/Firestore 규칙 오류와 WebRTC 연결 오류를 확인하세요.


## 6. Vercel로 웹에 공개하기 (추천)

이 프로젝트는 별도 빌드가 필요 없는 정적 HTML/CSS/JavaScript 게임입니다. 저장소 루트의 `vercel.json`이 Vercel에 `Other` 프레임워크와 `public` 출력 폴더를 지정합니다. Vercel은 게임 파일을 공개하고, Firebase는 로그인·방 정보·전적을 담당합니다.

### 방법 A: GitHub 연결로 배포 (초보자에게 권장)

1. GitHub 계정을 만들고 새 저장소(repository)를 생성합니다.
2. `job-fighter-online-start` 폴더 안의 파일 전체를 저장소 루트에 올립니다. 특히 `vercel.json`, `public/index.html`, `public/firebase-config.js`가 저장소에 있는지 확인합니다.
3. [Vercel](https://vercel.com/)에 로그인하고 **Add New → Project**에서 방금 만든 GitHub 저장소를 Import합니다.
4. 프로젝트 설정을 다음과 같이 확인합니다.
   - **Framework Preset:** Other
   - **Root Directory:** `./` (저장소 루트)
   - **Build Command:** 비워 둠
   - **Output Directory:** `public`
   - **Install Command:** 비워 둠/자동 설정
5. **Deploy**를 누릅니다. 완료되면 `https://프로젝트이름.vercel.app` 형태의 주소가 제공됩니다.
6. 코드를 수정한 뒤 GitHub 저장소에 다시 Push하면 Vercel이 새 배포를 자동으로 진행합니다.

### 방법 B: VS Code 터미널에서 Vercel CLI 사용

프로젝트 루트(즉, `vercel.json`이 있는 폴더)에서 VS Code 터미널을 열고 실행합니다.

```bash
npm install -g vercel
vercel login
vercel
```

처음 실행할 때 프로젝트 연결 질문에 안내대로 답합니다. 실제 공개 배포는 다음 명령을 사용합니다.

```bash
vercel --prod
```

### 6-1. Firebase에서 Vercel 주소 허용하기

Vercel 배포만으로 Firebase 도메인 허용이 자동 설정되지는 않습니다. Firebase Console에서 **Authentication → Settings → Authorized domains**로 이동해 Vercel의 고정 도메인(예: `프로젝트이름.vercel.app`)을 추가합니다. 커스텀 도메인을 연결했다면 그 도메인도 추가합니다. `https://`나 경로는 빼고 호스트 이름만 입력합니다.

`public/firebase-config.js`에는 본인 Firebase 웹 앱의 설정이 있어야 합니다. 이 프로젝트에서 사용 중인 익명 인증을 Firebase Authentication에서 활성화하고, Firestore도 생성해야 온라인 기능이 작동합니다.

### 6-2. 공개 전 보안 및 온라인 통신 주의사항

- `firestore.rules`의 방 문서 규칙은 로그인한 사용자라면 다른 사람의 방 문서도 읽고 쓸 수 있는 **개발/접속 시험용**입니다. 공개 운영 전에 방 생성자·참가자 UID 검증, 필드 검증, 만료 처리를 구현하고 규칙을 강화해야 합니다.
- Firebase 웹 설정의 `apiKey` 등은 브라우저에 전달되는 클라이언트 설정입니다. 서비스 계정 키, 비공개 키, 관리자 비밀번호를 `public` 폴더에 넣지 마세요.
- Vercel은 이 구성에서 게임 웹 파일을 호스팅합니다. 실시간 게임 데이터 교환은 기존처럼 Firebase Firestore 시그널링과 브라우저 간 WebRTC 연결이 담당합니다.
- 현재 WebRTC에는 STUN 서버만 설정되어 있습니다. 일부 NAT/방화벽 환경에서는 직접 연결이 실패할 수 있으므로, 실제 이용자 환경에서 시험하고 필요하면 별도 TURN 중계 서비스를 추가해야 합니다.
- 현재 게임 동기화는 서버 권위형 판정이 아니며, 위치·체력 등 일부 상태만 보정합니다. 랭킹/전적을 신뢰성 있게 운영하기 전에 전투 결과 검증도 별도로 보강해야 합니다.

## 7. Firebase Hosting으로 공개하기 (대안)

Node.js와 npm을 설치한 뒤 프로젝트 루트(`firebase.json`이 있는 폴더)에서 실행합니다.

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only hosting
```

최초 연결에서 프로젝트를 선택하고 Firebase 콘솔에 등록한 프로젝트를 지정합니다. 배포가 완료되면 터미널에 표시된 `https://프로젝트ID.web.app` 주소로 접속합니다.

Firestore 규칙을 수정한 경우에는 별도로 `firebase deploy --only firestore:rules`도 실행합니다.

## 8. 현재 온라인 버전의 한계

- WebRTC는 Google 공개 STUN 서버만 설정되어 있습니다. 일부 공유기/회사/학교 네트워크에서는 P2P 연결이 되지 않을 수 있고, 안정적인 서비스에는 TURN 중계 서버가 필요할 수 있습니다.
- ICE 후보 교환의 초기 저장 경쟁 상태와 같은 후보의 반복 적용을 줄이도록 보완했습니다.
- 게임 상태 보정은 현재 위치, 체력, 가드 게이지, 방향 등 일부 정보만 전달합니다. 모든 전투 판정이 서버 권위형으로 검증되는 구조는 아닙니다.
- 라운드 상태, 공격 판정, 투사체와 승패 정보까지 엄격하게 동기화하고 부정행위를 방지하려면 온라인 전투 구조를 추가로 설계해야 합니다.
- Firebase 연결과 실제 두 기기 대전은 개발자의 Firebase 프로젝트 설정 및 네트워크 환경에서 테스트해야 합니다.

## 프로젝트 구조

```text
job-fighter-online-start/
├─ .vscode/
│  ├─ extensions.json
│  └─ settings.json
├─ public/
│  ├─ index.html
│  └─ firebase-config.js
├─ firebase.json
├─ firestore.rules
├─ .gitignore
└─ README.md
```
