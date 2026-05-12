import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright";

let sharedBrowser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (sharedBrowser === null) {
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser !== null) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

export interface HarnessOptions {
  origin: string;
}

export type CeremonyKind = "create" | "get";

export interface CeremonyResult {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    attestationObject?: string;
    authenticatorData?: string;
    signature?: string;
    userHandle?: string;
  };
  authenticatorAttachment?: string;
  clientExtensionResults?: Record<string, unknown>;
}

const HARNESS_PATH = "/__parity_webauthn_blank";

const HARNESS_SCRIPT = `
(() => {
  function b64uToBuffer(s) {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - s.length % 4) % 4), "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  function bufferToB64u(buf) {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  }
  function decodeCreate(o) {
    const out = {
      challenge: b64uToBuffer(o.challenge),
      rp: o.rp,
      user: {
        id: b64uToBuffer(o.user.id),
        name: o.user.name,
        displayName: o.user.displayName,
      },
      pubKeyCredParams: o.pubKeyCredParams,
    };
    if (o.excludeCredentials !== undefined) {
      out.excludeCredentials = o.excludeCredentials.map((c) => {
        const cc = { type: c.type, id: b64uToBuffer(c.id) };
        if (c.transports !== undefined) cc.transports = c.transports;
        return cc;
      });
    }
    if (o.authenticatorSelection !== undefined) out.authenticatorSelection = o.authenticatorSelection;
    if (o.timeout !== undefined) out.timeout = o.timeout;
    if (o.attestation !== undefined) out.attestation = o.attestation;
    if (o.extensions !== undefined) out.extensions = o.extensions;
    return out;
  }
  function decodeGet(o) {
    const out = {
      challenge: b64uToBuffer(o.challenge),
      allowCredentials: (o.allowCredentials || []).map((c) => {
        const cc = { type: c.type, id: b64uToBuffer(c.id) };
        if (c.transports !== undefined) cc.transports = c.transports;
        return cc;
      }),
    };
    if (o.rpId !== undefined) out.rpId = o.rpId;
    if (o.userVerification !== undefined) out.userVerification = o.userVerification;
    if (o.timeout !== undefined) out.timeout = o.timeout;
    if (o.extensions !== undefined) out.extensions = o.extensions;
    return out;
  }
  function encodeCredential(cred) {
    const r = cred.response;
    const out = {
      id: cred.id,
      rawId: bufferToB64u(cred.rawId),
      type: "public-key",
      response: {
        clientDataJSON: bufferToB64u(r.clientDataJSON),
      },
    };
    if (r.attestationObject) out.response.attestationObject = bufferToB64u(r.attestationObject);
    if (r.authenticatorData) out.response.authenticatorData = bufferToB64u(r.authenticatorData);
    if (r.signature) out.response.signature = bufferToB64u(r.signature);
    if (r.userHandle) out.response.userHandle = bufferToB64u(r.userHandle);
    if (cred.authenticatorAttachment) out.authenticatorAttachment = cred.authenticatorAttachment;
    try {
      const ext = cred.getClientExtensionResults && cred.getClientExtensionResults();
      if (ext) out.clientExtensionResults = ext;
    } catch (e) {}
    return out;
  }
  globalThis.__parityWebauthn = { decodeCreate, decodeGet, encodeCredential };
})();
`;

export class WebAuthnHarness {
  private constructor(
    readonly context: BrowserContext,
    readonly page: Page,
    private readonly cdp: CDPSession,
    readonly authenticatorId: string,
  ) {}

  static async create(opts: HarnessOptions): Promise<WebAuthnHarness> {
    const browser = await getBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();

    const origin = opts.origin.replace(/\/+$/, "");
    const harnessUrl = `${origin}${HARNESS_PATH}`;
    await page.route(harnessUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><body></body></html>",
      }),
    );
    await page.addInitScript({ content: HARNESS_SCRIPT });
    await page.goto(harnessUrl);

    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const result = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    });

    return new WebAuthnHarness(context, page, cdp, result.authenticatorId);
  }

  async ceremony(
    kind: CeremonyKind,
    options: unknown,
  ): Promise<CeremonyResult> {
    return (await this.page.evaluate(
      async (args: { kind: CeremonyKind; options: unknown }) => {
        const g = globalThis as unknown as {
          __parityWebauthn: {
            decodeCreate: (o: unknown) => unknown;
            decodeGet: (o: unknown) => unknown;
            encodeCredential: (c: unknown) => unknown;
          };
          navigator: {
            credentials: {
              create: (o: unknown) => Promise<unknown>;
              get: (o: unknown) => Promise<unknown>;
            };
          };
        };
        const p = g.__parityWebauthn;
        const publicKey =
          args.kind === "create"
            ? p.decodeCreate(args.options)
            : p.decodeGet(args.options);
        const cred =
          args.kind === "create"
            ? await g.navigator.credentials.create({ publicKey })
            : await g.navigator.credentials.get({ publicKey });
        return p.encodeCredential(cred);
      },
      { kind, options },
    )) as CeremonyResult;
  }

  async destroy(): Promise<void> {
    await this.context.close();
  }
}
