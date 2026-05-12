import { CookieJar } from "tough-cookie";

export type Mode = "bearer" | "cookie";

export interface TransportOptions {
  baseUrl: string;
  mode: Mode;
}

export interface RequestSpec {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  omitCsrf?: boolean;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

export class Transport {
  readonly baseUrl: string;
  readonly mode: Mode;
  private readonly jar: CookieJar | null;
  private sessionToken: string | null = null;

  constructor(opts: TransportOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.mode = opts.mode;
    this.jar = opts.mode === "cookie" ? new CookieJar() : null;
  }

  getSessionToken(): string | null {
    return this.sessionToken;
  }

  async execute(req: RequestSpec): Promise<TransportResponse> {
    const url = `${this.baseUrl}${req.path}`;
    const headers = new Headers();
    if (req.headers) {
      for (const [k, v] of Object.entries(req.headers)) headers.set(k, v);
    }

    let body: string | undefined;
    if (req.body !== undefined && !METHODS_WITHOUT_BODY.has(req.method)) {
      body = JSON.stringify(req.body);
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }

    if (this.mode === "bearer" && this.sessionToken !== null) {
      headers.set("Authorization", `Bearer ${this.sessionToken}`);
    }

    if (this.jar !== null) {
      const cookieHeader = await this.jar.getCookieString(url);
      if (cookieHeader.length > 0) headers.set("Cookie", cookieHeader);
      if (!METHODS_WITHOUT_BODY.has(req.method) && req.omitCsrf !== true) {
        const cookies = await this.jar.getCookies(url);
        const csrf = cookies.find((c) => c.key === "csrf")?.value;
        if (csrf !== undefined) headers.set("X-CSRF-Token", csrf);
      }
    }

    const init: RequestInit = {
      method: req.method,
      headers,
      redirect: "manual",
    };
    if (body !== undefined) init.body = body;

    const res = await fetch(url, init);

    if (this.jar !== null) {
      const setCookies =
        typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : [];
      for (const c of setCookies) {
        await this.jar.setCookie(c, url, { ignoreError: true });
      }
    }

    const text = await res.text();
    let parsedBody: unknown = undefined;
    if (text.length > 0) {
      try {
        parsedBody = JSON.parse(text);
      } catch {
        parsedBody = text;
      }
    }

    if (
      this.mode === "bearer" &&
      parsedBody !== null &&
      typeof parsedBody === "object"
    ) {
      const b = parsedBody as Record<string, unknown>;
      if (typeof b.sessionToken === "string" && b.sessionToken.length > 0) {
        this.sessionToken = b.sessionToken;
      }
    }

    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    return { status: res.status, headers: respHeaders, body: parsedBody };
  }
}
