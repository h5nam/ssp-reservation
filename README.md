# SSP Reservation - 상상플래닛 회의실 예약 MCP 서버

> KT&G 상상플래닛 입주사를 위한 회의실 예약 자동화 도구

Claude Code와 연동하여 **자연어로 회의실을 조회하고 예약**할 수 있습니다.

```
나: "내일 오후 2시에 회의실 빈 곳 있어?"

Claude: ⭐ 14:00에 예약 가능한 회의실:
        - Meeting Room 201 (2층, 6인실)
        - Meeting Room 602 (6층, 4인실)

나: "201호 예약해줘, 3명, 주간회의"

Claude: ✅ 예약 신청 완료! (예약번호: 38815)
        📍 Meeting Room 201 (2층)
        📅 2026-04-08
        ⏰ 14:00 ~ 15:00
```

## Quick Start

### 1. 클론 및 설치

```bash
git clone https://github.com/h5nam/ssp-reservation.git
cd ssp-reservation
npm install
npm run build
```

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열고 상상플래닛 계정 정보를 입력합니다:

```env
SANGSANG_EMAIL=your-email@example.com
SANGSANG_PASSWORD=your-password
```

> `.env` 파일은 `.gitignore`에 포함되어 있어 git에 올라가지 않습니다.

### 3. Claude Code에서 사용

이 디렉토리에서 Claude Code를 실행하면 `.mcp.json`을 통해 MCP 서버가 자동 연결됩니다.

```bash
cd ssp-reservation
claude
```

`/mcp` 명령어로 `sangsangplanet · connected` 상태를 확인한 후 사용하세요.

## 사용 예시

| 요청 | 동작 |
|------|------|
| "내일 오후 2시에 회의실 빈 곳 있어?" | 특정 시간대 가용 회의실 조회 |
| "수요일 회의실 예약 현황 알려줘" | 전체 예약 현황 확인 |
| "6층 회의실만 보여줘" | 층별 필터링 조회 |
| "403호 10시~11시 예약해줘, 3명, 팀미팅" | 회의실 예약 (이름으로 자동 매핑) |
| "내 예약 목록 보여줘" | 예약 내역 조회 |

## MCP 도구

| 도구 | 설명 |
|------|------|
| `sangsang_login` | 상상플래닛 로그인 (자동 세션 관리) |
| `sangsang_available_rooms` | 날짜/시간/층별 회의실 가용성 조회 |
| `sangsang_book_room` | 회의실 예약 (이름 또는 번호로 지정 가능) |
| `sangsang_my_reservations` | 내 예약 목록 조회 |
| `sangsang_cancel_reservation` | 예약 취소 |

## 회의실 안내

| 회의실 | 층 | 인원 | spaceNo | 시설 |
|--------|-----|------|---------|------|
| Meeting Room 201 | 2층 | 6인 | 1 | 화이트보드, 모니터(HDMI) |
| Meeting Room 202 | 2층 | 6인 | 2 | 화이트보드, 모니터(HDMI) |
| Meeting Room 203 | 2층 | 6인 | 3 | 화이트보드, 모니터(HDMI) |
| Meeting Room 401 | 4층 | 8인 | 4 | 전자칠판, 화이트보드 |
| Meeting Room 402 | 4층 | 6인 | 5 | 전자칠판, 화이트보드 |
| Meeting Room 403 | 4층 | 6인 | 6 | 전자칠판, 화이트보드 |
| Meeting Room 501 | 5층 | 6인 | 7 | 전자칠판, 화이트보드 |
| Meeting Room 601 | 6층 | 4인 | 10 | 화이트보드, 모니터(HDMI) |
| Meeting Room 602 | 6층 | 4인 | 11 | 화이트보드, 모니터(HDMI) |

> "403호 예약해줘"라고 말하면 자동으로 spaceNo=6으로 변환됩니다.

## 보안

- 자격증명은 로컬 `.env` 파일에만 저장 (git 미포함)
- 브라우저와 100% 동일한 HTTPS 요청 전송
- 상상플래닛 서버 수정 없음
- 로그인 실패 시 최대 2회만 시도 후 중단 (계정 잠금 방지)
- 전체 소스코드 오픈소스 공개

## 기술 구조

```
src/
├── index.ts          # MCP 서버 엔트리포인트
├── client.ts         # HTTP 클라이언트 (쿠키 세션 관리, 자동 재로그인)
├── types.ts          # TypeScript 타입 정의
└── tools/
    ├── login.ts      # 2단계 로그인 (ajaxMemberCheck → loginProc)
    ├── rooms.ts      # 회의실 조회 (POST /membership/ajaxReser2)
    └── booking.ts    # 예약/취소/내역 조회 (POST /membership/ajaxReserProc)
```

## 참고사항

- 플래닛 멤버(M03 이상) 등급 필요
- 예약은 담당자 승인 후 확정 (spaceConfirmYn=Y인 경우)
- 운영시간: 2층 09:00~22:00 / 4~6층 00:00~24:00
- 1일 최대 2시간까지 예약 가능
- 최소 예약 단위: 30분

## License

MIT
