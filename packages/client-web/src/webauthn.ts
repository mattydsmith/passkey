import { AuthClientError } from "./errors.js";

export function bufferToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const standard = btoa(binary);
  return standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlToBuffer(b64url: string): ArrayBuffer {
  const padded = b64url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export interface ServerCreationOptions {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  excludeCredentials?: { type: "public-key"; id: string; transports?: string[] }[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  extensions?: AuthenticationExtensionsClientInputs;
}

export interface ServerRequestOptions {
  challenge: string;
  rpId?: string;
  allowCredentials?: { type: "public-key"; id: string; transports?: string[] }[];
  userVerification?: UserVerificationRequirement;
  timeout?: number;
  extensions?: AuthenticationExtensionsClientInputs;
}

export interface PublicKeyCredentialJSON {
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
  clientExtensionResults?: AuthenticationExtensionsClientOutputs;
}

export function decodeCreationOptions(
  o: ServerCreationOptions
): PublicKeyCredentialCreationOptions {
  return {
    challenge: base64urlToBuffer(o.challenge),
    rp: o.rp,
    user: {
      id: base64urlToBuffer(o.user.id),
      name: o.user.name,
      displayName: o.user.displayName,
    },
    pubKeyCredParams: o.pubKeyCredParams,
    ...(o.excludeCredentials !== undefined
      ? {
          excludeCredentials: o.excludeCredentials.map((c) => ({
            type: c.type,
            id: base64urlToBuffer(c.id),
            ...(c.transports !== undefined ? { transports: c.transports as AuthenticatorTransport[] } : {}),
          })),
        }
      : {}),
    ...(o.authenticatorSelection !== undefined ? { authenticatorSelection: o.authenticatorSelection } : {}),
    ...(o.timeout !== undefined ? { timeout: o.timeout } : {}),
    ...(o.attestation !== undefined ? { attestation: o.attestation } : {}),
    ...(o.extensions !== undefined ? { extensions: o.extensions } : {}),
  };
}

export function decodeRequestOptions(
  o: ServerRequestOptions
): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64urlToBuffer(o.challenge),
    ...(o.rpId !== undefined ? { rpId: o.rpId } : {}),
    allowCredentials: (o.allowCredentials ?? []).map((c) => ({
      type: c.type,
      id: base64urlToBuffer(c.id),
      ...(c.transports !== undefined ? { transports: c.transports as AuthenticatorTransport[] } : {}),
    })),
    ...(o.userVerification !== undefined ? { userVerification: o.userVerification } : {}),
    ...(o.timeout !== undefined ? { timeout: o.timeout } : {}),
    ...(o.extensions !== undefined ? { extensions: o.extensions } : {}),
  };
}

export function encodePublicKeyCredential(cred: PublicKeyCredential): PublicKeyCredentialJSON {
  const r = cred.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const attestationObject = (r as AuthenticatorAttestationResponse).attestationObject;
  const authenticatorData = (r as AuthenticatorAssertionResponse).authenticatorData;
  const signature = (r as AuthenticatorAssertionResponse).signature;
  const userHandle = (r as AuthenticatorAssertionResponse).userHandle;
  const out: PublicKeyCredentialJSON = {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: "public-key",
    response: {
      clientDataJSON: bufferToBase64url(r.clientDataJSON),
      ...(attestationObject ? { attestationObject: bufferToBase64url(attestationObject) } : {}),
      ...(authenticatorData ? { authenticatorData: bufferToBase64url(authenticatorData) } : {}),
      ...(signature ? { signature: bufferToBase64url(signature) } : {}),
      ...(userHandle ? { userHandle: bufferToBase64url(userHandle) } : {}),
    },
  };
  try {
    const ext = cred.getClientExtensionResults?.();
    if (ext) out.clientExtensionResults = ext;
  } catch {
    /* extensions are optional */
  }
  return out;
}

function mapWebAuthnError(err: unknown): AuthClientError {
  if (err && typeof err === "object" && "name" in err) {
    const name = (err as { name: string }).name;
    if (name === "NotAllowedError" || name === "AbortError") {
      return new AuthClientError("passkey_cancelled", "User cancelled or timed out", { cause: err });
    }
  }
  const msg = err instanceof Error ? err.message : "Passkey ceremony failed";
  return new AuthClientError("passkey_failed", msg, { cause: err });
}

function ensureSupported(): void {
  if (typeof navigator === "undefined" || !navigator.credentials) {
    throw new AuthClientError("unsupported", "navigator.credentials is not available");
  }
}

export async function performRegistration(
  options: ServerCreationOptions
): Promise<PublicKeyCredentialJSON> {
  ensureSupported();
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: decodeCreationOptions(options),
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw mapWebAuthnError(err);
  }
  if (!cred) throw new AuthClientError("passkey_failed", "No credential returned");
  return encodePublicKeyCredential(cred);
}

export async function performSignIn(
  options: ServerRequestOptions
): Promise<PublicKeyCredentialJSON> {
  ensureSupported();
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: decodeRequestOptions(options),
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw mapWebAuthnError(err);
  }
  if (!cred) throw new AuthClientError("passkey_failed", "No credential returned");
  return encodePublicKeyCredential(cred);
}
