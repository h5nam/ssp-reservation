import { CookieJar } from "tough-cookie";
import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import nodeFetch from "node-fetch";
import fetchCookie from "fetch-cookie";
import { LoginResult } from "./types.js";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = "https://www.sangsangplanet.com";
const execFileAsync = promisify(execFile);

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};

const AJAX_HEADERS: Record<string, string> = {
  ...DEFAULT_HEADERS,
  "X-Requested-With": "XMLHttpRequest",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
};

// Session expiry markers: short JS-only pages that redirect to login
const SESSION_EXPIRY_PATTERNS = [
  'confirm("로그인 후 이용 가능합니다")',
  "confirm('로그인 후 이용 가능합니다')",
  'location.href="/member/login"',
  "location.href='/member/login'",
];

type FetchOptions = {
  method?: string;
  body?: string | URLSearchParams;
  headers?: Record<string, string>;
  isAjax?: boolean;
};

export class SangsangClient {
  private fetchWithCookies: typeof nodeFetch;
  private cookieJar: CookieJar;
  private loggedIn = false;
  private reloginInProgress = false;
  private loginFailCount = 0;
  private static readonly MAX_LOGIN_ATTEMPTS = 2; // 절대 2회 초과 시도 안 함 (5회 잠금 방지)

  constructor() {
    this.cookieJar = new CookieJar();
    this.fetchWithCookies = fetchCookie(nodeFetch, this.cookieJar) as typeof nodeFetch;
  }

  async fetch(
    path: string,
    options: FetchOptions = {}
  ): Promise<{ status: number; text: string }> {
    const url = `${BASE_URL}${path}`;
    const isAjax = options.isAjax !== false;
    const method = options.method ?? "GET";
    const body = options.body?.toString();

    const headers = {
      ...(isAjax ? AJAX_HEADERS : DEFAULT_HEADERS),
      Referer: `${BASE_URL}/membership/reservation`,
      ...options.headers,
    };

    let status: number;
    let text: string;

    try {
      const res = await this.fetchWithCookies(url, {
        method,
        headers,
        body,
        redirect: "follow",
      });
      status = res.status;
      text = await res.text();
    } catch (error) {
      if (!this.canUseCurlFallback(path)) {
        throw error;
      }

      console.error(
        `Primary HTTP client failed for ${path}; retrying with curl fallback.`
      );
      const fallback = await this.fetchWithCurl(url, method, headers, body);
      status = fallback.status;
      text = fallback.text;
    }

    return this.handleSessionExpiry(path, options, status, text);
  }

  private async handleSessionExpiry(
    path: string,
    options: FetchOptions,
    status: number,
    text: string
  ): Promise<{ status: number; text: string }> {
    if (
      !path.includes("/member/") &&
      !this.reloginInProgress &&
      text.length < 500 &&
      SESSION_EXPIRY_PATTERNS.some((p) => text.includes(p))
    ) {
      if (this.loggedIn) {
        console.error("Session expired, attempting re-login...");
        this.loggedIn = false;
        this.reloginInProgress = true;
        try {
          const relogin = await this.login();
          if (relogin.success) {
            return this.fetch(path, options);
          }
        } finally {
          this.reloginInProgress = false;
        }
        throw new Error("Session expired and re-login failed");
      }
    }

    return { status, text };
  }

  private canUseCurlFallback(path: string): boolean {
    // Only retry read-only endpoints. Retrying login, booking, or cancellation
    // could expose credentials in process args or create duplicate side effects.
    return (
      path === "/membership/ajaxReser2" ||
      path === "/mypage/ajaxHtmlMeetingList"
    );
  }

  private async fetchWithCurl(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<{ status: number; text: string }> {
    let lastMessage = "unknown error";

    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        return await this.runCurl(url, method, headers, body);
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : String(error);
        if (attempt === 4) {
          break;
        }
        console.error(`curl fallback attempt ${attempt} failed; retrying.`);
        await delay(attempt * 2000);
      }
    }

    throw new Error(
      `curl fallback failed for ${new URL(url).pathname}: ${lastMessage}`
    );
  }

  private async runCurl(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<{ status: number; text: string }> {
    const args = [
      "--http1.1",
      "-sS",
      "-L",
      "--retry",
      "2",
      "--retry-delay",
      "2",
      "--connect-timeout",
      "15",
      "--max-time",
      "180",
      "-X",
      method,
    ];

    for (const [name, value] of Object.entries(headers)) {
      args.push("-H", `${name}: ${value}`);
    }

    const cookie = await this.cookieJar.getCookieString(url);
    if (cookie) {
      args.push("-H", `Cookie: ${cookie}`);
    }

    if (body !== undefined) {
      args.push("--data-raw", body);
    }

    const statusMarker = "__SSP_HTTP_STATUS__:";
    args.push("-w", `\n${statusMarker}%{http_code}`, url);

    let stdout: string;
    try {
      ({ stdout } = await execFileAsync("curl", args, {
        encoding: "utf8",
        maxBuffer: 120 * 1024 * 1024,
        timeout: 210_000,
      }));
    } catch (error) {
      const curlError = error as {
        code?: unknown;
        signal?: unknown;
        stderr?: unknown;
      };
      const stderr =
        typeof curlError.stderr === "string"
          ? curlError.stderr.split("\n")[0]
          : "";
      const exit = curlError.signal
        ? `signal ${String(curlError.signal)}`
        : `code ${String(curlError.code ?? "unknown")}`;
      throw new Error(stderr ? `curl exited with ${exit}: ${stderr}` : exit);
    }

    const markerIndex = stdout.lastIndexOf(statusMarker);
    if (markerIndex === -1) {
      return { status: 0, text: stdout };
    }

    const text = stdout.slice(0, markerIndex).replace(/\n$/, "");
    const status = Number(stdout.slice(markerIndex + statusMarker.length).trim());
    return { status, text };
  }

  async login(): Promise<LoginResult> {
    // Safety: never attempt login more than 2 times total per session
    // Sangsangplanet locks accounts after 5 failed attempts
    if (this.loginFailCount >= SangsangClient.MAX_LOGIN_ATTEMPTS) {
      return {
        success: false,
        message:
          `로그인 시도 ${this.loginFailCount}회 실패 — 추가 시도를 중단합니다. 계정 잠금 방지를 위해 비밀번호를 확인한 후 .env 파일을 수정하고 프로그램을 재시작하세요.`,
      };
    }

    const email = process.env.SANGSANG_EMAIL;
    const password = process.env.SANGSANG_PASSWORD;

    if (!email || !password) {
      return {
        success: false,
        message:
          "Missing credentials. Set SANGSANG_EMAIL and SANGSANG_PASSWORD in .env",
      };
    }

    try {
      // First, visit login page to establish initial cookies
      await this.fetch("/member/login", {
        isAjax: false,
        headers: { Accept: "text/html" },
      });

      // Step 1: Pre-check account status
      const checkRes = await this.fetch("/member/ajaxMemberCheck", {
        method: "POST",
        body: new URLSearchParams({
          memberId: email,
          loginType: "PLANET",
        }),
      });

      let checkData: Record<string, unknown>;
      try {
        checkData = JSON.parse(checkRes.text);
      } catch {
        checkData = {};
      }

      if (checkData.useYn === "N") {
        return { success: false, message: "Account is deactivated" };
      }
      if (checkData.dormantYn === "Y") {
        return {
          success: false,
          message: "Account is dormant. Reactivate on the website.",
        };
      }

      // Step 2: Login
      await this.fetch("/member/loginProc", {
        method: "POST",
        body: new URLSearchParams({
          memberId: email,
          memberPw: password,
          loginType: "PLANET",
          disconnectLogin: "Y",
        }),
      });

      // Step 3: Verify login by accessing a protected page
      const verifyRes = await this.fetch("/membership/main", {
        isAjax: false,
        headers: { Accept: "text/html" },
      });

      // If the page is very short and contains login redirect, login failed
      if (
        verifyRes.text.length < 500 &&
        SESSION_EXPIRY_PATTERNS.some((p) => verifyRes.text.includes(p))
      ) {
        this.loginFailCount++;
        return {
          success: false,
          message: `Login failed (attempt ${this.loginFailCount}/${SangsangClient.MAX_LOGIN_ATTEMPTS}). Check your credentials in .env file.`,
        };
      }

      this.loginFailCount = 0; // Reset on success
      this.loggedIn = true;
      return { success: true, message: "Successfully logged in to 상상플래닛" };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Login error: ${msg}` };
    }
  }

  isLoggedIn(): boolean {
    return this.loggedIn;
  }

  async ensureLoggedIn(): Promise<LoginResult> {
    if (this.loggedIn) {
      return { success: true, message: "Already logged in" };
    }
    return this.login();
  }
}
