# @mattsmith/passkey-sdk-client-web

Browser TypeScript client for the Passkey SDK. Wraps `fetch` and `navigator.credentials`, handles base64url ↔ ArrayBuffer conversion, manages session-token storage (cookie or `localStorage`), and surfaces typed errors mirroring the protocol's error codes.

Pure functions — no UI, no React/Vue/Svelte hooks. Those are explicit future work. The HTTP contract is documented in [`../../spec/protocol.md`](../../spec/protocol.md).

## Install

```bash
pnpm add @mattsmith/passkey-sdk-client-web
```

No runtime dependencies — uses only `fetch`, `navigator.credentials`, `localStorage`, and `document.cookie` from the browser standard library.

## Usage

```ts
import { createAuthClient, AuthClientError } from "@mattsmith/passkey-sdk-client-web";

const client = createAuthClient({
  baseUrl: "https://api.example.com/auth",
  storage: "cookie",   // or "header" for bearer-token mode
});

// Email OTP
const { otpId, expiresInSeconds } = await client.startEmailSignIn("matt@example.com");
const { user } = await client.verifyEmailOtp(otpId, "482917");

// Passkey
const { passkeyId } = await client.registerPasskey({ deviceName: "MacBook" });
const { user: signedIn } = await client.signInWithPasskey();

// Session + management
const { user: me } = await client.getCurrentUser();
const { sessions } = await client.listSessions();
const { passkeys } = await client.listPasskeys();
await client.deletePasskey(passkeyId);   // round-trips with registerPasskey's id
await client.signOut();
```

## Configuration

```ts
type AuthClientConfig = {
  baseUrl: string;
  storage: "cookie" | "header";
  fetch?: typeof fetch;             // override (testing, custom transport)
  storageKey?: string;              // header mode only. Default: "passkey-sdk:session"
  csrfCookieName?: string;          // cookie mode only. Default: "csrf"
};
```

## Storage modes

- **`cookie`**: browser handles the `session` cookie set by the server. Client never sees the raw token. Transport sets `credentials: "include"` and adds `X-CSRF-Token` from the `csrf` cookie on every non-GET request.
- **`header`**: client persists `sessionToken` in `localStorage` after `verifyEmailOtp` / `signInWithPasskey` and sends `Authorization: Bearer <token>` on subsequent requests. CSRF is moot in this mode.

The raw `sessionToken` is **never returned** from public methods — `verifyEmailOtp` and `signInWithPasskey` return only `{ user }`. Cookie mode has the browser; header mode has `localStorage`.

## Errors

Every method can throw `AuthClientError`:

```ts
import { isAuthClientError } from "@mattsmith/passkey-sdk-client-web";

try {
  await client.verifyEmailOtp(otpId, code);
} catch (e) {
  if (isAuthClientError(e)) {
    switch (e.code) {
      case "invalid_otp":           // Wrong code
      case "otp_attempts_exceeded": // Too many tries
      case "otp_expired":           // 10-min window passed
      case "passkey_cancelled":     // User dismissed prompt / aborted
      case "network":               // fetch failed / non-JSON response
      case "unsupported":           // navigator.credentials missing
      // ... etc.
    }
  }
}
```

Full code list: [`spec/protocol.md`](../../spec/protocol.md) (server codes) plus client-only `network`, `passkey_cancelled`, `passkey_failed`, `unsupported`.

## Tests

```bash
pnpm --filter @mattsmith/passkey-sdk-client-web test
```

vitest + jsdom + msw covering transport, storage, WebAuthn wrapper, and every public method. The reference Playwright e2e against a live server lives in [`../../examples/web-demo`](../../examples/web-demo).
