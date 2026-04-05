import { CookieJar } from "tough-cookie";
import nodeFetch from "node-fetch";
import fetchCookie from "fetch-cookie";
import { LoginResult } from "./types.js";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = "https://www.sangsangplanet.com";

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

export class SangsangClient {
  private fetchWithCookies: typeof nodeFetch;
  private loggedIn = false;
  private reloginInProgress = false;

  constructor() {
    const jar = new CookieJar();
    this.fetchWithCookies = fetchCookie(nodeFetch, jar) as typeof nodeFetch;
  }

  async fetch(
    path: string,
    options: {
      method?: string;
      body?: string | URLSearchParams;
      headers?: Record<string, string>;
      isAjax?: boolean;
    } = {}
  ): Promise<{ status: number; text: string }> {
    const url = `${BASE_URL}${path}`;
    const isAjax = options.isAjax !== false;

    const headers = {
      ...(isAjax ? AJAX_HEADERS : DEFAULT_HEADERS),
      Referer: `${BASE_URL}/membership/reservation`,
      ...options.headers,
    };

    const res = await this.fetchWithCookies(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body?.toString(),
      redirect: "follow",
    });

    const text = await res.text();

    // Detect session expiry: only on short redirect-to-login pages
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

    return { status: res.status, text };
  }

  async login(): Promise<LoginResult> {
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
        return {
          success: false,
          message: "Login failed. Check your credentials.",
        };
      }

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
