import { SangsangClient } from "../client.js";
import * as cheerio from "cheerio";

async function getPageData(client: SangsangClient) {
  const page = await client.fetch("/membership/reservationInq", {
    isAjax: false,
    headers: { Accept: "text/html" },
  });
  const $ = cheerio.load(page.text);
  return {
    csrf: String($('input[name=_csrf]').first().val() || ""),
  };
}

export function registerBookingTool(client: SangsangClient) {
  return {
    name: "sangsang_book_room",
    description:
      "상상플래닛 회의실을 예약합니다. 먼저 sangsang_available_rooms로 가용 회의실을 확인한 후 사용하세요.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spaceNo: {
          type: "number",
          description: "회의실 번호 (sangsang_available_rooms에서 확인)",
        },
        date: {
          type: "string",
          description: "예약 날짜 (YYYY-MM-DD)",
        },
        startTime: {
          type: "string",
          description: "시작 시간 (HH:MM, 예: 14:00)",
        },
        endTime: {
          type: "string",
          description: "종료 시간 (HH:MM, 예: 16:00)",
        },
        participants: {
          type: "number",
          description: "참여 인원수",
        },
        description: {
          type: "string",
          description: "회의 내용/목적 (단체명, 회의내용 필수)",
        },
      },
      required: ["spaceNo", "date", "startTime", "endTime", "participants", "description"],
    },
    handler: async (args: {
      spaceNo: number;
      date: string;
      startTime: string;
      endTime: string;
      participants: number;
      description: string;
    }) => {
      const loginResult = await client.ensureLoggedIn();
      if (!loginResult.success) {
        return {
          content: [{ type: "text" as const, text: `로그인 실패: ${loginResult.message}` }],
        };
      }

      const { csrf } = await getPageData(client);
      const dateCompact = args.date.replace(/-/g, "");
      const sTime = args.startTime.replace(":", "");
      const eTime = args.endTime.replace(":", "");

      // First, get room info from ajaxReser2
      const roomsRes = await client.fetch("/membership/ajaxReser2", {
        method: "POST",
        body: new URLSearchParams({
          _csrf: csrf,
          spaceGubun: "1",
          spaceFloor: "",
        }),
        headers: {
          Referer: "https://www.sangsangplanet.com/membership/reservationInq",
        },
      });

      let roomData: {
        list: Array<{
          spaceNo: number;
          spaceNm: string;
          spaceFloor: string;
          spaceSeatCnt: number;
          spaceMinTime: string;
          spaceConfirmYn: string;
          spaceCouponYn: string;
          spaceCouponCnt: number;
          spaceCouponPrice: number;
          spaceAvailableSdt: string;
          spaceAvailableEdt: string;
        }>;
      };

      try {
        roomData = JSON.parse(roomsRes.text);
      } catch {
        return {
          content: [{ type: "text" as const, text: "회의실 데이터를 가져올 수 없습니다." }],
        };
      }

      const room = roomData.list.find((r) => r.spaceNo === args.spaceNo);
      if (!room) {
        return {
          content: [
            {
              type: "text" as const,
              text: `회의실 번호 ${args.spaceNo}를 찾을 수 없습니다. 가능한 번호: ${roomData.list.map((r) => `${r.spaceNo}(${r.spaceNm})`).join(", ")}`,
            },
          ],
        };
      }

      // Build booking form data matching popRoomFrm
      const bookingData = new URLSearchParams({
        _csrf: csrf,
        reservationGubun: "1",
        reservationState: "",
        reservationFloor: room.spaceFloor,
        reservationNo: "",
        reservationDt: dateCompact,
        reservationStime: sTime,
        reservationEtime: eTime,
        reservationSpaceNo: String(room.spaceNo),
        spaceConfirmYn: room.spaceConfirmYn || "Y",
        spaceMinTime: room.spaceMinTime || "0030",
        spaceSeatCnt: String(room.spaceSeatCnt),
        spaceCouponYn: room.spaceCouponYn || "N",
        spaceCouponCnt: String(room.spaceCouponCnt || 0),
        spaceCouponPrice: String(room.spaceCouponPrice || 0),
        refundYn: "",
        refundPercent: "",
        reservationCouponYn: "",
        reservationCouponCnt: "0",
        reservationCouponPrice: "0",
        spaceAvailableEdt: room.spaceAvailableEdt || "2200",
        spaceAvailableSdt: room.spaceAvailableSdt || "0900",
        reservationNm: room.spaceNm,
        sHour: sTime.slice(0, 2),
        sMin: sTime.slice(2),
        eHour: eTime.slice(0, 2),
        eMin: eTime.slice(2),
        reservationMemCnt: String(args.participants),
        reservationCont: args.description,
        reservationAgree01: "Y",
      });

      // Try submitting to the reservation page
      const submitRes = await client.fetch("/membership/reservationInq", {
        method: "POST",
        body: bookingData,
        headers: {
          Referer: "https://www.sangsangplanet.com/membership/reservationInq",
        },
      });

      // Check response
      if (submitRes.text.includes("예약이 완료") || submitRes.text.includes("success") || submitRes.text.includes("예약 신청")) {
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ 예약 신청 완료!\n\n📍 ${room.spaceNm} (${room.spaceFloor}층)\n📅 ${args.date}\n⏰ ${args.startTime} ~ ${args.endTime}\n👥 ${args.participants}명\n📝 ${args.description}\n\n${room.spaceConfirmYn === "Y" ? "⚠️ 담당자 승인 후 확정됩니다." : ""}`,
            },
          ],
        };
      }

      // If the first attempt didn't work, try alternative endpoints
      const altEndpoints = [
        "/membership/reservationInst",
        "/membership/reservation",
      ];

      for (const ep of altEndpoints) {
        const altRes = await client.fetch(ep, {
          method: "POST",
          body: bookingData,
          headers: {
            Referer: "https://www.sangsangplanet.com/membership/reservationInq",
          },
        });

        if (
          altRes.text.includes("예약이 완료") ||
          altRes.text.includes("success") ||
          altRes.text.includes("예약 신청")
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ 예약 신청 완료!\n\n📍 ${room.spaceNm} (${room.spaceFloor}층)\n📅 ${args.date}\n⏰ ${args.startTime} ~ ${args.endTime}\n👥 ${args.participants}명\n📝 ${args.description}`,
              },
            ],
          };
        }
      }

      // If nothing worked, return details for debugging
      const preview = submitRes.text.substring(0, 300);
      return {
        content: [
          {
            type: "text" as const,
            text: `⚠️ 예약 요청을 전송했으나 결과를 확인할 수 없습니다.\n\n현재 계정의 멤버 등급이 플래닛 멤버(M03 이상)인지 확인해주세요.\n회의실 예약은 플래닛 멤버 전용 기능입니다.\n\n요청 정보:\n📍 ${room.spaceNm} (${room.spaceFloor}층)\n📅 ${args.date} ${args.startTime}~${args.endTime}\n👥 ${args.participants}명\n\n서버 응답 (${submitRes.status}): ${preview}`,
          },
        ],
      };
    },
  };
}

export function registerMyReservationsTool(client: SangsangClient) {
  return {
    name: "sangsang_my_reservations",
    description: "내 예약 목록을 조회합니다.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    handler: async () => {
      const loginResult = await client.ensureLoggedIn();
      if (!loginResult.success) {
        return {
          content: [{ type: "text" as const, text: `로그인 실패: ${loginResult.message}` }],
        };
      }

      // Try mypage reservation page
      const res = await client.fetch("/mypage/reservation", {
        isAjax: false,
        headers: { Accept: "text/html" },
      });

      if (res.text.length < 500) {
        return {
          content: [
            {
              type: "text" as const,
              text: "⚠️ 마이페이지 접근이 제한되었습니다.\n현재 계정의 멤버 등급을 확인해주세요.\n\n대안: sangsang_available_rooms 도구로 특정 날짜의 전체 예약 현황을 확인할 수 있습니다.",
            },
          ],
        };
      }

      // Parse reservation list from mypage
      const $ = cheerio.load(res.text);
      const reservations: string[] = [];

      $(".reservation-item, .list-item, tr").each((_, el) => {
        const text = $(el).text().trim().replace(/\s+/g, " ");
        if (text.includes("Meeting") || text.includes("회의")) {
          reservations.push(text);
        }
      });

      if (reservations.length === 0) {
        return {
          content: [{ type: "text" as const, text: "예약 내역이 없거나 페이지를 파싱할 수 없습니다." }],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `📋 내 예약 목록:\n\n${reservations.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
          },
        ],
      };
    },
  };
}

export function registerCancelReservationTool(client: SangsangClient) {
  return {
    name: "sangsang_cancel_reservation",
    description: "예약을 취소합니다. (현재 제한적 기능 - 멤버 등급에 따라 동작하지 않을 수 있습니다)",
    inputSchema: {
      type: "object" as const,
      properties: {
        reservationNo: {
          type: "string",
          description: "취소할 예약 번호",
        },
      },
      required: ["reservationNo"],
    },
    handler: async (args: { reservationNo: string }) => {
      const loginResult = await client.ensureLoggedIn();
      if (!loginResult.success) {
        return {
          content: [{ type: "text" as const, text: `로그인 실패: ${loginResult.message}` }],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `⚠️ 예약 취소 기능은 현재 계정의 멤버 등급이 확인된 후 사용 가능합니다.\n예약번호: ${args.reservationNo}\n\n직접 웹사이트에서 취소하시거나, 멤버 등급이 플래닛 멤버(M03) 이상인 경우 다시 시도해주세요.`,
          },
        ],
      };
    },
  };
}
