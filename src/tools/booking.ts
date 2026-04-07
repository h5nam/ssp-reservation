import { SangsangClient } from "../client.js";
import * as cheerio from "cheerio";

async function getPageData(client: SangsangClient) {
  // Try /membership/reservation first (플래닛멤버 전용, CSRF token source)
  let page = await client.fetch("/membership/reservation", {
    isAjax: false,
    headers: { Accept: "text/html" },
  });

  // Fallback to reservationInq if reservation page is blocked
  if (page.text.length < 500) {
    page = await client.fetch("/membership/reservationInq", {
      isAjax: false,
      headers: { Accept: "text/html" },
    });
  }

  const $ = cheerio.load(page.text);
  return {
    csrf: String($('input[name=_csrf]').first().val() || ""),
    memberType: String($('form[name=rFrm] input[name=memberType]').val() || ""),
    memberNo: String($('form[name=rFrm] input[name=memberNo]').val() || ""),
    memberAuth: String($('form[name=rFrm] input[name=memberAuth]').val() || ""),
  };
}

export function registerBookingTool(client: SangsangClient) {
  return {
    name: "sangsang_book_room",
    description:
      "상상플래닛 회의실을 예약합니다. roomName 또는 spaceNo 중 하나를 지정하세요. 회의실 매핑: 201호=1, 202호=2, 203호=3, 401호=4, 402호=5, 403호=6, 501호=7, 601호=10, 602호=11",
    inputSchema: {
      type: "object" as const,
      properties: {
        roomName: {
          type: "string",
          description: "회의실 이름 (예: '403', '403호', 'Meeting Room 403'). spaceNo 대신 사용 가능",
        },
        spaceNo: {
          type: "number",
          description: "회의실 번호 (201호=1, 202호=2, 203호=3, 401호=4, 402호=5, 403호=6, 501호=7, 601호=10, 602호=11)",
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
      required: ["date", "startTime", "endTime", "participants", "description"],
    },
    handler: async (args: {
      roomName?: string;
      spaceNo?: number;
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

      // Room name to spaceNo mapping
      const ROOM_MAP: Record<string, number> = {
        "201": 1, "202": 2, "203": 3,
        "401": 4, "402": 5, "403": 6,
        "501": 7, "601": 10, "602": 11,
      };

      let resolvedSpaceNo = args.spaceNo;

      if (!resolvedSpaceNo && args.roomName) {
        // Extract room number from name like "403", "403호", "Meeting Room 403"
        const match = args.roomName.match(/(\d{3})/);
        if (match && ROOM_MAP[match[1]]) {
          resolvedSpaceNo = ROOM_MAP[match[1]];
        }
      }

      if (!resolvedSpaceNo) {
        return {
          content: [{
            type: "text" as const,
            text: "회의실을 지정해주세요. 예: roomName='403' 또는 spaceNo=6\n\n회의실 매핑: 201호=1, 202호=2, 203호=3, 401호=4, 402호=5, 403호=6, 501호=7, 601호=10, 602호=11",
          }],
        };
      }

      const { csrf, memberType, memberNo, memberAuth } = await getPageData(client);
      const dateCompact = args.date.replace(/-/g, "");
      const sTime = args.startTime.replace(":", "");
      const eTime = args.endTime.replace(":", "");

      // First, get room info from ajaxReser2
      const roomsRes = await client.fetch("/membership/ajaxReser2", {
        method: "POST",
        body: new URLSearchParams({
          _csrf: csrf,
          memberType,
          memberNo,
          spaceGubun: "1",
          spaceFloor: "",
        }),
        headers: {
          Origin: "https://www.sangsangplanet.com",
          Referer: "https://www.sangsangplanet.com/membership/reservation",
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

      const room = roomData.list.find((r) => r.spaceNo === resolvedSpaceNo);
      if (!room) {
        return {
          content: [
            {
              type: "text" as const,
              text: `회의실 번호 ${resolvedSpaceNo}를 찾을 수 없습니다. 가능한 번호: ${roomData.list.map((r) => `${r.spaceNo}(${r.spaceNm})`).join(", ")}`,
            },
          ],
        };
      }

      // Build booking form data matching exact browser request
      const couponPrice = room.spaceCouponPrice || 0;
      // Calculate number of 30-min slots
      const startMinutes = parseInt(sTime.slice(0, 2)) * 60 + parseInt(sTime.slice(2));
      const endMinutes = parseInt(eTime.slice(0, 2)) * 60 + parseInt(eTime.slice(2));
      const slotCount = (endMinutes - startMinutes) / 30;
      const totalCupPoint = couponPrice * slotCount;
      const bookingData = new URLSearchParams({
        _csrf: csrf,
        reservationGubun: "1",
        reservationState: "",
        reservationFloor: room.spaceFloor,
        reservationNo: "0",
        reservationDt: dateCompact,
        reservationStime: sTime,
        reservationEtime: eTime,
        reservationSpaceNo: String(room.spaceNo),
        spaceConfirmYn: room.spaceConfirmYn || "Y",
        spaceMinTime: room.spaceMinTime || "0030",
        spaceSeatCnt: String(room.spaceSeatCnt),
        spaceCouponYn: room.spaceCouponYn || "Y",
        spaceCouponCnt: String(room.spaceCouponCnt || 0),
        spaceCupPoint: "",
        spaceCouponPrice: String(couponPrice),
        refundYn: "",
        refundPercent: "",
        reservationCouponYn: "Y",
        reservationCouponCnt: "0",
        reservationCupPoint: String(totalCupPoint),
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

      // Submit reservation via POST /membership/ajaxReserProc
      if (!csrf) {
        return {
          content: [{ type: "text" as const, text: "⚠️ CSRF 토큰을 가져올 수 없습니다. 로그인 상태를 확인해주세요." }],
        };
      }

      const submitRes = await client.fetch("/membership/ajaxReserProc", {
        method: "POST",
        body: bookingData,
        headers: {
          Origin: "https://www.sangsangplanet.com",
          Referer: "https://www.sangsangplanet.com/membership/reservation",
        },
      });

      let submitData: {
        success?: boolean;
        duplicate?: boolean;
        overlap?: boolean;
        point?: boolean;
        checkFloor?: boolean;
        maxtime?: boolean;
        priceDiff?: boolean;
        reservationNo?: number;
      };

      try {
        submitData = JSON.parse(submitRes.text);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: `⚠️ 서버 응답을 파싱할 수 없습니다.\n응답 (${submitRes.status}): ${submitRes.text.substring(0, 300)}`,
            },
          ],
        };
      }

      // Debug: log what we sent and received
      console.error("[DEBUG booking] room:", JSON.stringify({
        spaceNo: room.spaceNo,
        spaceNm: room.spaceNm,
        spaceCouponPrice: room.spaceCouponPrice,
        spaceCouponYn: room.spaceCouponYn,
        spaceCouponCnt: room.spaceCouponCnt,
        spaceConfirmYn: room.spaceConfirmYn,
      }));
      console.error("[DEBUG booking] calculated:", { couponPrice, slotCount, totalCupPoint });
      console.error("[DEBUG booking] response:", JSON.stringify(submitData));

      // Handle error responses
      if (submitData.duplicate || submitData.checkFloor) {
        return {
          content: [{ type: "text" as const, text: "❌ 시간이 중복되는 예약이 존재합니다." }],
        };
      }
      if (submitData.overlap) {
        return {
          content: [{ type: "text" as const, text: "❌ 1일 기준 최대 2시간까지 예약 가능합니다." }],
        };
      }
      if (submitData.point) {
        return {
          content: [{ type: "text" as const, text: "❌ 모든 포인트가 소진되었습니다. 대표 및 권한이 있는 멤버만 추가 예약 가능합니다." }],
        };
      }
      if (submitData.priceDiff) {
        return {
          content: [{ type: "text" as const, text: "❌ 올바른 접근이 아닙니다. 다시 시도해주세요." }],
        };
      }
      if (submitData.maxtime) {
        return {
          content: [{ type: "text" as const, text: "❌ 22시까지만 예약 가능합니다." }],
        };
      }

      // Success
      if (submitData.success) {
        const confirmMsg = room.spaceConfirmYn === "Y"
          ? "예약이 확정되었습니다."
          : "담당 매니저가 확인 후 승인하여 안내드리겠습니다.";
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ 예약 신청 완료! (예약번호: ${submitData.reservationNo})\n\n📍 ${room.spaceNm} (${room.spaceFloor}층)\n📅 ${args.date}\n⏰ ${args.startTime} ~ ${args.endTime}\n👥 ${args.participants}명\n📝 ${args.description}\n\n${confirmMsg}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `❌ 예약 신청에 실패했습니다.\n서버 응답: ${JSON.stringify(submitData)}`,
          },
        ],
      };
    },
  };
}

export function registerMyReservationsTool(client: SangsangClient) {
  return {
    name: "sangsang_my_reservations",
    description: "내 예약 목록을 조회합니다. 특정 날짜를 지정하면 해당 날짜의 내 예약을 확인합니다. 미지정 시 마이페이지에서 전체 내역을 조회합니다.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "조회할 날짜 (YYYY-MM-DD). 미지정 시 마이페이지에서 전체 내역 조회",
        },
      },
    },
    handler: async (args?: { date?: string }) => {
      const loginResult = await client.ensureLoggedIn();
      if (!loginResult.success) {
        return {
          content: [{ type: "text" as const, text: `로그인 실패: ${loginResult.message}` }],
        };
      }

      // If date specified, use ajaxReser2 to find my reservations (myYn/teamYn flags)
      if (args?.date) {
        const { csrf, memberType, memberNo, memberAuth } = await getPageData(client);
        const dateCompact = args.date.replace(/-/g, "");

        const res = await client.fetch("/membership/ajaxReser2", {
          method: "POST",
          body: new URLSearchParams({
            _csrf: csrf,
            memberType,
            memberNo,
            memberAuth,
            spaceGubun: "1",
            spaceFloor: "",
          }),
          headers: {
            Origin: "https://www.sangsangplanet.com",
            Referer: "https://www.sangsangplanet.com/membership/reservation",
          },
        });

        let data: {
          list: Array<{ spaceNo: number; spaceNm: string; spaceFloor: string }>;
          reservationList: Array<{
            reservationDt: string;
            reservationSpaceNo: number;
            reservationStime: string;
            reservationEtime: string;
            reservationNo: number;
            reservationNm: string;
            reservationFloor: string;
            reservationMemCnt: string;
            myYn: string;
            teamYn: string;
            reservationState: string;
          }>;
        };

        try {
          data = JSON.parse(res.text);
        } catch {
          return { content: [{ type: "text" as const, text: "데이터를 파싱할 수 없습니다." }] };
        }

        // Filter reservations for the target date that are mine or my team's
        const myReservations = data.reservationList.filter(
          (r) => r.reservationDt === dateCompact && (r.myYn === "Y" || r.teamYn === "Y")
        );

        if (myReservations.length === 0) {
          return {
            content: [{ type: "text" as const, text: `📅 ${args.date}에 예약된 내 회의실이 없습니다.` }],
          };
        }

        // Build room name lookup
        const roomMap = new Map(data.list.map((r) => [r.spaceNo, r.spaceNm]));

        let output = `📅 ${args.date} 내 예약 목록\n\n`;
        for (const r of myReservations) {
          const roomName = roomMap.get(r.reservationSpaceNo) || r.reservationNm || `spaceNo:${r.reservationSpaceNo}`;
          const sTime = `${r.reservationStime.slice(0, 2)}:${r.reservationStime.slice(2)}`;
          const eTime = `${r.reservationEtime.slice(0, 2)}:${r.reservationEtime.slice(2)}`;
          const isTeam = r.teamYn === "Y" && r.myYn !== "Y" ? " (팀)" : "";
          const isMine = r.myYn === "Y" ? " (본인)" : "";
          output += `📌 #${r.reservationNo} ${roomName} (${r.reservationFloor}층)${isMine}${isTeam}\n`;
          output += `   ⏰ ${sTime}~${eTime} | 👥 ${r.reservationMemCnt}명\n\n`;
        }

        return { content: [{ type: "text" as const, text: output }] };
      }

      // No date specified: fall back to mypage for full history
      const page = await client.fetch("/mypage/reservation", {
        isAjax: false,
        headers: { Accept: "text/html" },
      });

      if (page.text.length < 500) {
        return {
          content: [
            {
              type: "text" as const,
              text: "⚠️ 마이페이지 접근이 제한되었습니다.\n날짜를 지정하면 해당 날짜의 내 예약을 확인할 수 있습니다. (예: date='2026-04-09')",
            },
          ],
        };
      }

      const $page = cheerio.load(page.text);
      const csrf = String($page("form[name=reserFrm] input[name=_csrf]").val() || "");

      // Fetch meeting reservation list via AJAX endpoint
      const res = await client.fetch("/mypage/ajaxHtmlMeetingList", {
        method: "POST",
        body: new URLSearchParams({
          _csrf: csrf,
          currtPg: "1",
        }),
        headers: {
          Referer: "https://www.sangsangplanet.com/mypage/reservation",
        },
      });

      if (res.text.length < 50) {
        return {
          content: [{ type: "text" as const, text: "예약 내역이 없습니다." }],
        };
      }

      // Parse reservation table
      const $ = cheerio.load(res.text);

      // Extract point info
      const pointInfo = $(".my_cupon_wrap").text().trim().replace(/\s+/g, " ");

      // Extract reservations from table
      interface ReservationEntry {
        no: string;
        room: string;
        period: string;
        points: string;
        extra: string;
        person: string;
        date: string;
        status: string;
      }
      const reservations: ReservationEntry[] = [];

      $("table.table_list tbody tr").each((_, el) => {
        const tds = $(el).find("td");
        if (tds.length >= 7) {
          // PC period is class="period pc", mobile is "period mb" — use PC version
          const no = $(tds[0]).text().trim();
          const room = $(tds[1]).text().trim();
          const periodPc = $(el).find("td.period.pc").text().trim().replace(/\s+/g, " ");
          const pointsTd = $(el).find("td.coupon").eq(0).text().trim().replace(/\s+/g, " ");
          const extraTd = $(el).find("td.coupon").eq(1).text().trim().replace(/\s+/g, " ");
          const person = $(el).find("td.name").text().trim();
          const dateTd = $(el).find("td.date").text().trim();
          const status = $(el).find("td.state").text().trim();

          reservations.push({
            no,
            room,
            period: periodPc,
            points: pointsTd,
            extra: extraTd,
            person,
            date: dateTd,
            status,
          });
        }
      });

      if (reservations.length === 0) {
        return {
          content: [{ type: "text" as const, text: "예약 내역이 없습니다." }],
        };
      }

      let output = `📋 내 회의실 예약 목록\n${pointInfo}\n\n`;

      for (const r of reservations) {
        const statusIcon = r.status.includes("승인") ? "✅" :
          r.status.includes("대기") ? "⏳" :
          r.status.includes("취소") ? "❌" : "📌";
        output += `${statusIcon} #${r.no} ${r.room}\n`;
        output += `   📅 ${r.period}\n`;
        output += `   💰 포인트: ${r.points} / 추가: ${r.extra}\n`;
        output += `   👤 ${r.person} | 예약일: ${r.date} | 상태: ${r.status}\n\n`;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: output,
          },
        ],
      };
    },
  };
}

export function registerCancelReservationTool(client: SangsangClient) {
  return {
    name: "sangsang_cancel_reservation",
    description: "예약을 취소합니다. sangsang_my_reservations에서 예약번호를 확인한 후 사용하세요.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reservationNo: {
          type: "string",
          description: "취소할 예약 번호 (sangsang_my_reservations에서 확인)",
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

      // Get CSRF token and reservation details from mypage
      const page = await client.fetch("/mypage/reservation", {
        isAjax: false,
        headers: { Accept: "text/html" },
      });

      if (page.text.length < 500) {
        return {
          content: [{ type: "text" as const, text: "⚠️ 마이페이지 접근이 제한되었습니다." }],
        };
      }

      const $ = cheerio.load(page.text);
      const csrf = String($("form[name=reserFrm] input[name=_csrf]").val() || "");

      if (!csrf) {
        return {
          content: [{ type: "text" as const, text: "⚠️ CSRF 토큰을 가져올 수 없습니다." }],
        };
      }

      // First get the reservation details to build the cancel form
      const meetingListRes = await client.fetch("/mypage/ajaxHtmlMeetingList", {
        method: "POST",
        body: new URLSearchParams({ _csrf: csrf, currtPg: "1" }),
        headers: { Referer: "https://www.sangsangplanet.com/mypage/reservation" },
      });

      // Find the cancel button/form data for this reservation from the page
      // The cancel endpoint needs the full reservation data
      const cancelData = new URLSearchParams({
        _csrf: csrf,
        reservationNo: args.reservationNo,
      });

      const cancelRes = await client.fetch("/membership/ajaxDeleteReser", {
        method: "POST",
        body: cancelData,
        headers: {
          Origin: "https://www.sangsangplanet.com",
          Referer: "https://www.sangsangplanet.com/membership/reservation",
        },
      });

      let cancelResult: { success?: boolean; message?: string };
      try {
        cancelResult = JSON.parse(cancelRes.text);
      } catch {
        // If not JSON, check for success indicators in text
        if (cancelRes.status === 200 && cancelRes.text.length < 500) {
          return {
            content: [{
              type: "text" as const,
              text: `✅ 예약번호 ${args.reservationNo} 취소 요청을 전송했습니다.\n\n마이페이지에서 취소 상태를 확인해주세요.`,
            }],
          };
        }
        return {
          content: [{
            type: "text" as const,
            text: `⚠️ 서버 응답을 파싱할 수 없습니다.\n응답 (${cancelRes.status}): ${cancelRes.text.substring(0, 300)}`,
          }],
        };
      }

      if (cancelResult.success) {
        return {
          content: [{
            type: "text" as const,
            text: `✅ 예약번호 ${args.reservationNo} 취소 완료!`,
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: `❌ 예약 취소 실패.\n서버 응답: ${JSON.stringify(cancelResult)}`,
        }],
      };
    },
  };
}
