# 3D Map Exploration Game (Full-Stack)

Babylon.js 3D 지도 탐험 인터랙티브 웹 애플리케이션의 풀스택(Full-Stack) 프로젝트입니다.
기존 단일 HTML 파일 구조에서 **Express.js 기반 백엔드 API**와 **Vite 기반 프론트엔드 클라이언트**로 깔끔하게 분리되었습니다.

---

## 📁 프로젝트 구조

```
Map/
├── client/                      # [프론트엔드] Vite + Babylon.js 클라이언트
│   ├── index.html               # 게임 Canvas 및 HUD UI
│   ├── vite.config.js           # 프론트엔드 번들러 및 API 프록시 설정
│   ├── package.json             # 클라이언트 의존성
│   └── src/
│       ├── main.js              # Babylon.js 씬, 캐릭터, 지도 텍스처, HUD 렌더링
│       └── api.js               # 백엔드 Express REST API 통신 모듈
│
├── server/                      # [백엔드] Express.js REST API 서버
│   ├── package.json             # 서버 의존성
│   ├── .env                     # 서버 환경설정 (PORT, CORS 등)
│   └── src/
│       ├── server.js            # Express 서버 진입점
│       ├── routes/
│       │   └── locations.js     # 위치 및 POI 관련 API 엔드포인트
│       └── data/
│           ├── locations.js     # 기본 도시/지역 좌표 데이터
│           └── pois.js          # 관심 지점(POI), 지하철 출구, 병원 데이터
│
├── package.json                 # [루트] 원클릭 동시 실행 스크립트 (concurrently)
└── README.md
```

---

## 🚀 실행 방법 (한 번에 실행하기)

루트 디렉토리에서 아래 명령어를 실행하면 **Express 백엔드(포트 3001)**와 **Vite 프론트엔드(포트 5173)**가 동시에 실행됩니다.

```bash
# 개발 모드로 백엔드 + 프론트엔드 동시 실행
npm run dev
```

브라우저에서 [http://localhost:5173](http://localhost:5173) 으로 접속하면 게임을 플레이할 수 있습니다.

---

## 🛠️ 추가 명령어

```bash
# 전체 의존성 한 번에 설치 (루트, 서버, 클라이언트)
npm run install:all

# 백엔드 서버만 단독 실행
npm run dev:server

# 프론트엔드 클라이언트만 단독 실행
npm run dev:client

# 프론트엔드 프로덕션 빌드
npm run build:client
```

---

## 📡 백엔드 REST API 명세

| 메서드 | 엔드포인트 | 설명 |
|---|---|---|
| `GET` | `/api/health` | 서버 상태 헬스체크 |
| `GET` | `/api/locations` | 탐험 가능한 모든 위치(도시/역) 목록 조회 |
| `GET` | `/api/locations/colors` | Google Maps 테마 컬러 팔레트 조회 |
| `GET` | `/api/locations/:id` | 특정 위치 상세 정보 조회 |
| `GET` | `/api/locations/:id/pois` | 특정 위치의 POI(지하철, 병원, 쇼핑몰 등) 목록 조회 |
| `POST` | `/api/locations/:id/pois` | 특정 위치에 새로운 커스텀 POI 동적 추가 |
