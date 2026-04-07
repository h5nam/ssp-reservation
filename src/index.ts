#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SangsangClient } from "./client.js";
import { registerLoginTool } from "./tools/login.js";
import { registerRoomsTool } from "./tools/rooms.js";
import {
  registerBookingTool,
  registerMyReservationsTool,
  registerCancelReservationTool,
} from "./tools/booking.js";
import { z } from "zod";

const client = new SangsangClient();

const server = new McpServer({
  name: "sangsangplanet",
  version: "1.0.0",
});

// Register login tool
const loginDef = registerLoginTool(client);
server.tool(loginDef.name, loginDef.description, {}, async () => {
  return loginDef.handler();
});

// Register available rooms tool
const roomsDef = registerRoomsTool(client);
server.tool(
  roomsDef.name,
  roomsDef.description,
  {
    date: z.string().optional().describe("조회할 날짜 (YYYY-MM-DD). 미지정시 내일"),
    floor: z.string().optional().describe("특정 층만 조회 (2, 4, 5, 6)"),
    time_preference: z.string().optional().describe("선호 시간대 (예: '14:00')"),
  },
  async (args) => {
    return roomsDef.handler(args);
  }
);

// Register booking tool
const bookingDef = registerBookingTool(client);
server.tool(
  bookingDef.name,
  bookingDef.description,
  {
    roomName: z.string().optional().describe("회의실 이름 (예: '403', '403호'). 매핑: 201=1,202=2,203=3,401=4,402=5,403=6,501=7,601=10,602=11"),
    spaceNo: z.number().optional().describe("회의실 번호 (roomName 사용 시 불필요)"),
    date: z.string().describe("예약 날짜 (YYYY-MM-DD)"),
    startTime: z.string().describe("시작 시간 (HH:MM)"),
    endTime: z.string().describe("종료 시간 (HH:MM)"),
    participants: z.number().describe("참여 인원수"),
    description: z.string().describe("회의 내용/목적"),
  },
  async (args) => {
    return bookingDef.handler(args);
  }
);

// Register my reservations tool
const myResDef = registerMyReservationsTool(client);
server.tool(myResDef.name, myResDef.description, {}, async () => {
  return myResDef.handler();
});

// Register cancel reservation tool
const cancelDef = registerCancelReservationTool(client);
server.tool(
  cancelDef.name,
  cancelDef.description,
  {
    reservationNo: z.string().describe("취소할 예약 번호"),
  },
  async (args) => {
    return cancelDef.handler(args);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("상상플래닛 MCP 서버가 시작되었습니다.");
}

main().catch((error) => {
  console.error("서버 시작 실패:", error);
  process.exit(1);
});
