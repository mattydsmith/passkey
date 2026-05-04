import { test, expect, type Page } from "@playwright/test";

const EMAIL = `e2e-${Date.now()}@example.com`;

async function readStatus(page: Page): Promise<string> {
  return (await page.locator("#out").textContent()) ?? "";
}

async function fetchLastOtp(email: string): Promise<string> {
  const res = await fetch(
    `http://localhost:5173/__test/last-otp?email=${encodeURIComponent(email)}`
  );
  if (!res.ok) throw new Error(`last-otp returned ${res.status}`);
  const body = (await res.json()) as { code: string };
  return body.code;
}

test("full flow: email OTP → register passkey → sign-out → sign-in with passkey", async ({
  page,
  context,
}) => {
  // Add a virtual authenticator via CDP (Chromium-only)
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });

  await page.goto("/");

  // Email OTP — start
  await page.locator("#email").fill(EMAIL);
  await page.locator("#btn-start").click();
  await expect.poll(() => readStatus(page)).toContain("startEmailSignIn");
  expect(await readStatus(page)).toContain("otpId");

  // Pull the OTP from the test endpoint
  const code = await fetchLastOtp(EMAIL);

  // Email OTP — verify
  await page.locator("#otp").fill(code);
  await page.locator("#btn-verify").click();
  await expect.poll(() => readStatus(page)).toContain("verifyEmailOtp");
  expect(await readStatus(page)).toContain(EMAIL);

  // Register passkey (virtual authenticator auto-confirms)
  await page.locator("#btn-register").click();
  await expect.poll(() => readStatus(page)).toContain("registerPasskey");
  expect(await readStatus(page)).toMatch(/passkeyId/);

  // Get current user — confirms session is active
  await page.locator("#btn-me").click();
  await expect.poll(() => readStatus(page)).toContain("getCurrentUser");
  expect(await readStatus(page)).toContain("u_");

  // Sign out
  await page.locator("#btn-signout").click();
  await expect.poll(() => readStatus(page)).toContain("signOut");

  // Confirm signed out: /me should now error
  await page.locator("#btn-me").click();
  await expect.poll(() => readStatus(page)).toContain("ERROR unauthenticated");

  // Sign in with passkey — should succeed using the resident credential
  await page.locator("#btn-signin").click();
  await expect.poll(() => readStatus(page)).toContain("signInWithPasskey");
  expect(await readStatus(page)).toMatch(/u_/);

  // /me again — back in
  await page.locator("#btn-me").click();
  await expect.poll(() => readStatus(page)).toContain("getCurrentUser");

  // listPasskeys returns the registered credential
  await page.locator("#btn-passkeys").click();
  await expect.poll(() => readStatus(page)).toContain("listPasskeys");
  expect(await readStatus(page)).toContain("Demo browser");

  // Delete the passkey using the id returned by registerPasskey —
  // this validates that registerPasskey's id round-trips through deletePasskey
  await page.locator("#btn-delete").click();
  await expect.poll(() => readStatus(page)).toContain("deletePasskey");
  expect(await readStatus(page)).toContain("ok");

  // listPasskeys is now empty
  await page.locator("#btn-passkeys").click();
  await expect.poll(() => readStatus(page)).toContain("listPasskeys");
  expect(await readStatus(page)).toContain('"passkeys": []');
});
