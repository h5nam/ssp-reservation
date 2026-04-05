import { SangsangClient } from "../client.js";
import * as cheerio from "cheerio";

interface RoomInfo {
  spaceNo: number;
  name: string;
  floor: string;
  seats: number;
  minTime: string;
  operatingHours: string;
  confirmRequired: boolean;
  couponPrice: number;
}

interface TimeSlot {
  time: string;
  status: "available" | "booked" | "impossible";
}

interface RoomAvailability {
  spaceNo: number;
  name: string;
  floor: string;
  seats: number;
  slots: TimeSlot[];
}

const TIME_SLOTS = [
  "0900", "0930", "1000", "1030", "1100", "1130",
  "1200", "1230", "1300", "1330", "1400", "1430",
  "1500", "1530", "1600", "1630", "1700", "1730",
  "1800", "1830", "1900", "1930", "2000", "2030",
  "2100", "2130",
];

function formatTime(t: string): string {
  return `${t.slice(0, 2)}:${t.slice(2)}`;
}

async function getCsrfToken(client: SangsangClient): Promise<string> {
  const page = await client.fetch("/membership/reservationInq", {
    isAjax: false,
    headers: { Accept: "text/html" },
  });
  const $ = cheerio.load(page.text);
  return String($('input[name=_csrf]').first().val() || "");
}

export function registerRoomsTool(client: SangsangClient) {
  return {
    name: "sangsang_available_rooms",
    description:
      "특정 날짜에 예약 가능한 회의실과 시간대를 조회합니다. 날짜를 지정하면 각 회의실별 예약 가능/불가능 시간대를 보여줍니다.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description:
            "조회할 날짜 (YYYY-MM-DD 형식, 예: 2025-04-07). 미지정시 내일 날짜",
        },
        floor: {
          type: "string",
          description: "특정 층만 조회 (2, 4, 5, 6). 미지정시 전체",
        },
        time_preference: {
          type: "string",
          description:
            "선호 시간대 (예: '14:00', '오후 2시'). 해당 시간대 전후 가용성을 강조해서 보여줍니다.",
        },
      },
    },
    handler: async (args: { date?: string; floor?: string; time_preference?: string }) => {
      const loginResult = await client.ensureLoggedIn();
      if (!loginResult.success) {
        return {
          content: [{ type: "text" as const, text: `로그인 실패: ${loginResult.message}` }],
        };
      }

      const csrf = await getCsrfToken(client);

      // Default to tomorrow
      let dateStr = args.date;
      if (!dateStr) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateStr = tomorrow.toISOString().split("T")[0];
      }
      const dateCompact = dateStr.replace(/-/g, "");

      const params = new URLSearchParams({
        _csrf: csrf,
        memberType: "",
        memberNo: "",
        spaceGubun: "1", // 1=meeting rooms
        spaceFloor: args.floor || "",
      });

      const res = await client.fetch("/membership/ajaxReser2", {
        method: "POST",
        body: params,
        headers: {
          Referer: "https://www.sangsangplanet.com/membership/reservationInq",
        },
      });

      let data: {
        list: Array<{
          spaceNo: number;
          spaceNm: string;
          spaceFloor: string;
          spaceSeatCnt: number;
          spaceMinTime: string;
          spaceAvailableSdt: string;
          spaceAvailableEdt: string;
          spaceConfirmYn: string;
          spaceCouponPrice: number;
        }>;
        reservationList: Array<{
          reservationDt: string;
          reservationSpaceNo: number;
          reservationStime: string;
          reservationEtime: string;
        }>;
        noUseList: Array<{
          spaceDt: string;
          spaceParentsNo: string;
        }>;
      };

      try {
        data = JSON.parse(res.text);
      } catch {
        return {
          content: [{ type: "text" as const, text: "예약 데이터를 파싱할 수 없습니다." }],
        };
      }

      const rooms: RoomAvailability[] = data.list.map((room) => {
        const slots: TimeSlot[] = TIME_SLOTS.filter((t) => {
          const sdt = room.spaceAvailableSdt || "0900";
          const edt = room.spaceAvailableEdt || "2200";
          return t >= sdt && t < edt;
        }).map((t) => {
          // Check if no-use date
          const isNoUse = data.noUseList.some(
            (n) => n.spaceDt === dateCompact && String(n.spaceParentsNo) === String(room.spaceNo)
          );
          if (isNoUse) return { time: formatTime(t), status: "impossible" as const };

          // Check if booked
          const isBooked = data.reservationList.some((r) => {
            if (r.reservationDt !== dateCompact) return false;
            if (r.reservationSpaceNo !== room.spaceNo) return false;
            // Check if time t falls within reservation range
            return t >= r.reservationStime && t < r.reservationEtime;
          });
          if (isBooked) return { time: formatTime(t), status: "booked" as const };

          return { time: formatTime(t), status: "available" as const };
        });

        return {
          spaceNo: room.spaceNo,
          name: room.spaceNm,
          floor: room.spaceFloor,
          seats: room.spaceSeatCnt,
          slots,
        };
      });

      // Filter by floor if specified
      const filtered = args.floor
        ? rooms.filter((r) => r.floor === args.floor)
        : rooms;

      // Build human-readable output
      let output = `📅 ${dateStr} 회의실 예약 현황\n\n`;

      for (const room of filtered) {
        const availableSlots = room.slots.filter((s) => s.status === "available");
        output += `🏢 ${room.name} (${room.floor}층, ${room.seats}인실)\n`;

        if (availableSlots.length === 0) {
          output += `  ❌ 예약 가능한 시간이 없습니다\n`;
        } else {
          // Group consecutive available slots
          const groups: string[] = [];
          let start = availableSlots[0].time;
          let prev = availableSlots[0].time;

          for (let i = 1; i < availableSlots.length; i++) {
            const curr = availableSlots[i].time;
            const prevMinutes =
              parseInt(prev.split(":")[0]) * 60 + parseInt(prev.split(":")[1]);
            const currMinutes =
              parseInt(curr.split(":")[0]) * 60 + parseInt(curr.split(":")[1]);

            if (currMinutes - prevMinutes > 30) {
              // Add 30 min to prev for end time
              const endMin = prevMinutes + 30;
              const endH = String(Math.floor(endMin / 60)).padStart(2, "0");
              const endM = String(endMin % 60).padStart(2, "0");
              groups.push(`${start}~${endH}:${endM}`);
              start = curr;
            }
            prev = curr;
          }
          // Last group
          const lastMin =
            parseInt(prev.split(":")[0]) * 60 + parseInt(prev.split(":")[1]) + 30;
          const lastH = String(Math.floor(lastMin / 60)).padStart(2, "0");
          const lastM = String(lastMin % 60).padStart(2, "0");
          groups.push(`${start}~${lastH}:${lastM}`);

          output += `  ✅ 예약 가능: ${groups.join(", ")}\n`;
        }
        output += "\n";
      }

      // If time preference given, highlight
      if (args.time_preference) {
        const pref = args.time_preference.replace(/[^0-9]/g, "").padStart(4, "0");
        const prefTime = `${pref.slice(0, 2)}:${pref.slice(2)}`;
        const availableAtPref = filtered.filter((r) =>
          r.slots.some((s) => s.time === prefTime && s.status === "available")
        );
        if (availableAtPref.length > 0) {
          output += `\n⭐ ${prefTime}에 예약 가능한 회의실:\n`;
          for (const r of availableAtPref) {
            output += `  - ${r.name} (${r.floor}층, ${r.seats}인실, spaceNo: ${r.spaceNo})\n`;
          }
        } else {
          output += `\n⚠️ ${prefTime}에 예약 가능한 회의실이 없습니다.\n`;
        }
      }

      return {
        content: [{ type: "text" as const, text: output }],
      };
    },
  };
}
