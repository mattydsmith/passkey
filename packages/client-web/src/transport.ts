import { AuthClientError, type AuthClientErrorCode } from "./errors.js";
import type { SessionStorage } from "./storage.js";

export interface TransportOptions {
  baseUrl: string;
  storage: SessionStorage;
  fetch?: typeof fetch;
  csrfCookieName?: string;
}

export interface RequestOptions {
  method: "GET" | "POST" | "DELETE";
  body?: unknown;
}

export interface Transport {
  request<T = unknown>(path: string, opts: RequestOptions): Promise<T>;
}

const DEFAULT_CSRF_COOKIE = "csrf";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === name && v !== undefined) return decodeURIComponent(v);
  }
  return null;
}

export function createTransport(opts: TransportOptions): Transport {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const csrfCookieName = opts.csrfCookieName ?? DEFAULT_CSRF_COOKIE;

  return {
    async request<T = unknown>(path: string, ro: RequestOptions): Promise<T> {
      const url = baseUrl + (path.startsWith("/") ? path : `/${path}`);
      const headers = new Headers();
      const init: RequestInit = { method: ro.method, headers };

      if (ro.body !== undefined) {
        headers.set("Content-Type", "application/json");
        init.body = JSON.stringify(ro.body);
      }

      opts.storage.attachToRequest(headers);
      if (opts.storage.includeCredentials) {
        init.credentials = "include";
        if (ro.method !== "GET") {
          const csrf = readCookie(csrfCookieName);
          if (csrf) headers.set("X-CSRF-Token", csrf);
        }
      }

      let response: Response;
      try {
        response = await fetchImpl(url, init);
      } catch (err) {
        throw new AuthClientError("network", "Network request failed", { cause: err });
      }

      let parsed: any;
      const text = await response.text();
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          throw new AuthClientError("network", "Response was not valid JSON", {
            status: response.status,
            cause: err,
          });
        }
      }

      if (!response.ok) {
        const code = (parsed?.error as AuthClientErrorCode | string) ?? "network";
        const message = (parsed?.message as string) ?? response.statusText;
        throw new AuthClientError(code, message, { status: response.status });
      }

      return parsed as T;
    },
  };
}
