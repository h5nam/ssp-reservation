# 상상플래닛 회의실 예약 MCP 서버

KT&G 상상플래닛 입주사를 위한 회의실 예약 자동화 도구입니다.
Claude Code와 연동하여 자연어로 회의실을 조회하고 예약할 수 있습니다.

## 설치

```bash
npm install
npm run build
```

## 설정

1. `.env` 파일을 생성하고 상상플래닛 로그인 정보를 입력합니다:

```bash
cp .env.example .env
# .env 파일을 열어 이메일과 비밀번호를 입력
```

2. Claude Code가 이 프로젝트 디렉토리에서 실행되면 `.mcp.json`을 통해 MCP 서버가 자동 연결됩니다.

## 사용법

이 프로젝트 디렉토리에서 Claude Code를 실행한 후 자연어로 요청하세요:

```
"내일 오후 2시에 회의실 빈 곳 있어?"
"Meeting Room 501 12시반에 예약해줘, 4명, 주간회의"
"수요일 회의실 예약 현황 알려줘"
```

## MCP 도구

| 도구 | 설명 |
|------|------|
| `sangsang_login` | 상상플래닛 로그인 |
| `sangsang_available_rooms` | 날짜별 회의실 가용성 조회 |
| `sangsang_book_room` | 회의실 예약 |
| `sangsang_my_reservations` | 내 예약 목록 조회 |
| `sangsang_cancel_reservation` | 예약 취소 |

## 회의실 목록

| 회의실 | 층 | 인원 |
|--------|-----|------|
| Meeting Room 201 | 2층 | 6인 |
| Meeting Room 202 | 2층 | 6인 |
| Meeting Room 203 | 2층 | 6인 |
| Meeting Room 401 | 4층 | 8인 |
| Meeting Room 402 | 4층 | 6인 |
| Meeting Room 403 | 4층 | 6인 |
| Meeting Room 501 | 5층 | 6인 |
| Meeting Room 601 | 6층 | 4인 |
| Meeting Room 602 | 6층 | 4인 |

## 참고사항

- 플래닛 멤버(M03) 이상 등급이 필요합니다
- 회의실 예약은 담당자 승인 후 확정됩니다
- 운영시간: 09:00~22:00, 30분 단위
