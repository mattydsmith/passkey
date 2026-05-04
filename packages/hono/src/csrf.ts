import type { MiddlewareHandler } from "hono";

export interface CsrfOptions {
  sessionCookieName: string;
  csrfCookieName: string;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === name && v !== undefined) return decodeURIComponent(v);
  }
  return null;
}

export function csrfMiddleware(opts: CsrfOptions): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD") return next();

    const cookieHeader = c.req.header("cookie") ?? null;
    const sessionCookie = readCookie(cookieHeader, opts.sessionCookieName);
    if (!sessionCookie) return next();

    const csrfCookie = readCookie(cookieHeader, opts.csrfCookieName);
    const headerToken = c.req.header("x-csrf-token") ?? null;

    if (!csrfCookie || !headerToken || csrfCookie !== headerToken) {
      return c.json(
        { error: "csrf_required", message: "CSRF token missing or invalid" },
        403
      );
    }
    return next();
  };
}
