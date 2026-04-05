# SSP Reservation - 상상플래닛 회의실 예약 MCP 서버

> KT&G 상상플래닛 입주사를 위한 회의실 예약 자동화 도구

Claude Code와 연동하여 **자연어로 회의실을 조회하고 예약**할 수 있습니다.

```
나: "내일 오후 2시에 회의실 빈 곳 있어?"

Claude: ⭐ 14:00에 예약 가능한 회의실:
        - Meeting Room 201 (2층, 6인실)
        - Meeting Room 602 (6층, 4인실)

나: "201호 예약해줘, 3명, 주간회의"

Claude: ✅ 예약 신청 완료!
        📍 Meeting Room 201 (2층)
        📅 2026-04-07
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

### 3. Claude Code에서 사용

이 디렉토리에서 Claude Code를 실행하면 `.mcp.json`을 통해 MCP 서버가 자동 연결됩니다.

```bash
cd ssp-reservation
claude
```

## 사용 예시

| 요청 | 동작 |
|------|------|
| "내일 오후 2시에 회의실 빈 곳 있어?" | 특정 시간대 가용 회의실 조회 |
| "수요일 회의실 예약 현황 알려줘" | 전체 예약 현황 확인 |
| "6층 회의실만 보여줘" | 층별 필터링 조회 |
| "501호 12:30~13:30 예약해줘, 4명, 팀 미팅" | 회의실 예약 |
| "내 예약 목록 보여줘" | 예약 내역 조회 |

## MCP 도구

| 도구 | 설명 |
|------|------|
| `sangsang_login` | 상상플래닛 로그인 (자동 세션 관리) |
| `sangsang_available_rooms` | 날짜/시간/층별 회의실 가용성 조회 |
| `sangsang_book_room` | 회의실 예약 신청 |
| `sangsang_my_reservations` | 내 예약 목록 조회 |
| `sangsang_cancel_reservation` | 예약 취소 |

## 회의실 안내

| 회의실 | 층 | 인원 | 비고 |
|--------|-----|------|------|
| Meeting Room 201 | 2층 | 6인 | |
| Meeting Room 202 | 2층 | 6인 | |
| Meeting Room 203 | 2층 | 6인 | |
| Meeting Room 401 | 4층 | 8인 | 대형 회의실 |
| Meeting Room 402 | 4층 | 6인 | |
| Meeting Room 403 | 4층 | 6인 | |
| Meeting Room 501 | 5층 | 6인 | |
| Meeting Room 601 | 6층 | 4인 | 소형 회의실 |
| Meeting Room 602 | 6층 | 4인 | 소형 회의실 |

## 기술 구조

```
src/
├── index.ts          # MCP 서버 엔트리포인트
├── client.ts         # HTTP 클라이언트 (쿠키 세션 관리, 자동 재로그인)
├── types.ts          # TypeScript 타입 정의
└── tools/
    ├── login.ts      # 2단계 로그인 (ajaxMemberCheck → loginProc)
    ├── rooms.ts      # 회의실 조회 (POST /membership/ajaxReser2)
    └── booking.ts    # 예약/취소/내역 조회
```

## 참고사항

- 플래닛 멤버(M03) 이상 등급이 필요합니다
- 예약은 담당자 승인 후 확정됩니다
- 운영시간: 09:00~22:00, 30분 단위
- 1일 최대 2시간까지 예약 가능
- 당일 예약 불가, 사용일 1일 전까지 신청 가능

## License

MIT
