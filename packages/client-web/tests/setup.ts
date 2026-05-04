// Default jsdom doesn't include PublicKeyCredential, so feature-detection
// of WebAuthn returns false unless we stub it. Tests that exercise WebAuthn
// install their own stub via vi.stubGlobal.
