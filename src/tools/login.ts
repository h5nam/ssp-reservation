import { SangsangClient } from "../client.js";

export function registerLoginTool(client: SangsangClient) {
  return {
    name: "sangsang_login",
    description:
      "상상플래닛에 로그인합니다. 다른 도구를 사용하기 전에 먼저 로그인해야 합니다. 자격증명은 환경변수에서 자동으로 로드됩니다.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    handler: async () => {
      const result = await client.login();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  };
}
