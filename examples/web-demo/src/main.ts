import { createAuthClient, AuthClientError } from "@mattsmith/passkey-sdk-client-web";

const client = createAuthClient({
  baseUrl: "/auth",
  storage: "cookie",
});

const out = document.getElementById("out") as HTMLPreElement;
let pendingOtpId: string | null = null;
let pendingPasskeyId: string | null = null;

function show(label: string, value: unknown) {
  const text =
    value instanceof AuthClientError
      ? `ERROR ${value.code}: ${value.message}`
      : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
  out.textContent = `[${label}] ${text}`;
}

function $(id: string): HTMLInputElement | HTMLButtonElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as HTMLInputElement | HTMLButtonElement;
}

$("btn-start").addEventListener("click", async () => {
  try {
    const email = ($("email") as HTMLInputElement).value;
    const res = await client.startEmailSignIn(email);
    pendingOtpId = res.otpId;
    show("startEmailSignIn", res);
  } catch (e) { show("startEmailSignIn", e); }
});

$("btn-verify").addEventListener("click", async () => {
  try {
    if (!pendingOtpId) return show("verifyEmailOtp", "no pending otpId");
    const code = ($("otp") as HTMLInputElement).value;
    const res = await client.verifyEmailOtp(pendingOtpId, code);
    show("verifyEmailOtp", res);
  } catch (e) { show("verifyEmailOtp", e); }
});

$("btn-register").addEventListener("click", async () => {
  try {
    const res = await client.registerPasskey({ deviceName: "Demo browser" });
    pendingPasskeyId = res.passkeyId;
    show("registerPasskey", res);
  } catch (e) { show("registerPasskey", e); }
});

$("btn-signin").addEventListener("click", async () => {
  try {
    const res = await client.signInWithPasskey();
    show("signInWithPasskey", res);
  } catch (e) { show("signInWithPasskey", e); }
});

$("btn-me").addEventListener("click", async () => {
  try {
    const res = await client.getCurrentUser();
    show("getCurrentUser", res);
  } catch (e) { show("getCurrentUser", e); }
});

$("btn-signout").addEventListener("click", async () => {
  try {
    await client.signOut();
    show("signOut", "ok");
  } catch (e) { show("signOut", e); }
});

$("btn-sessions").addEventListener("click", async () => {
  try {
    const res = await client.listSessions();
    show("listSessions", res);
  } catch (e) { show("listSessions", e); }
});

$("btn-passkeys").addEventListener("click", async () => {
  try {
    const res = await client.listPasskeys();
    show("listPasskeys", res);
    if (pendingPasskeyId !== null) {
      // expose for e2e
      (window as any).__lastPasskeyId = pendingPasskeyId;
    }
  } catch (e) { show("listPasskeys", e); }
});
