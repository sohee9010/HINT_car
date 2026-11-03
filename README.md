# 날아라 슈퍼카

장애물을 피하고, 막히면 날아서 넘는 3D 레이싱 웹게임입니다. 설치 없이 브라우저에서 바로 실행됩니다.

## 조작

| | 컴퓨터 | 휴대폰 |
| --- | --- | --- |
| 차선 이동 | ← → | 아래 `<` `>` 버튼 |
| 날기 | 스페이스 | 가운데 날기 버튼 |
| 시작 / 다시 하기 | Enter | 화면 버튼 |

- 10초 버티면 100점이에요.
- 날 때마다 연료를 쓰고, 연료통을 먹으면 채워져요. 무지개 연료통을 먹으면 5초 동안 날아요.
- 판마다 시간대와 날씨(맑음·비·눈)가 랜덤으로 바뀌어요.

## 폴더 구조

```
index.html          화면 구조
css/style.css       디자인
js/config.js        Firebase 설정 (firebaseConfig)
js/leaderboard.js   순위 저장 (Firebase 또는 이 브라우저)
js/game.js          게임
assets/music.mp3    배경음악
firestore.rules     순위 보안 규칙 (Firestore)
```

## 실행하기

`index.html`을 더블클릭하면 배경음악 파일을 못 읽는 브라우저가 있어요. 간단한 로컬 서버로 여는 게 좋아요.

```bash
python -m http.server 8000
```

그다음 브라우저에서 http://localhost:8000 을 열어요.

## 온라인 순위 (Firebase)

설정하기 전에는 순위가 **이 브라우저에만** 저장돼요. 모두가 같은 순위를 보려면 Firebase 콘솔에서:

1. **Firestore Database** → 데이터베이스 만들기 (프로덕션 모드, 가까운 지역).
2. **Firestore Database → 규칙** 탭에 `firestore.rules` 내용을 붙여 넣고 게시해요.
3. **Authentication → 시작하기 → 로그인 방법 → 익명** 을 사용 설정해요. 회원가입 화면 없이 브라우저마다 고유 아이디를 주는 기능이에요.
4. **프로젝트 설정 → 일반 → 내 앱**에서 웹 앱(</>)을 추가하고, 나오는 `firebaseConfig` 값들을 `js/config.js`에 넣어요.
5. 사이트를 올린 주소(예: GitHub Pages)를 **Authentication → 설정 → 승인된 도메인**에 추가해요.

`firebaseConfig`는 웹사이트에 공개돼도 되는 값이에요. 방문자가 할 수 있는 일은 보안 규칙으로 "순위 읽기"와 "내 기록 올리기"로만 제한돼요. 서비스 계정 키는 절대 넣지 마세요.

알아 둘 점: 로그인 없이 쓰는 게임이라, 마음먹고 조작하면 가짜 점수를 올릴 수 있어요. 친구들끼리 즐기는 용도로는 충분하고, 이상한 기록은 Firestore 콘솔에서 지우면 돼요.

## 크레딧

- 3D 그래픽: [three.js](https://threejs.org) r128
- 글꼴: Black Han Sans, IBM Plex Sans KR (Google Fonts)
- 배경음악: Across the Clover Patch — 공개 저장소에 올리기 전에 사용 허락(라이선스)을 확인하세요.
