// Default jsdom doesn't include PublicKeyCredential, so feature-detection
// of WebAuthn returns false unless we stub it. Tests that exercise WebAuthn
// install their own stub via vi.stubGlobal.

// jsdom's default `about:blank` origin is opaque, so accessing
// `localStorage` throws a SecurityError; Node 25 also ships an experimental
// webstorage global that shadows `localStorage` and lacks Storage methods.
// Install a Map-backed Storage shim on both `window` and `globalThis` so
// SDK code and tests see a working browser-shaped `localStorage`.
function createStorageShim(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}
const storageShim = createStorageShim();
Object.defineProperty(globalThis, "localStorage", {
  value: storageShim,
  writable: true,
  configurable: true,
});
Object.defineProperty(window, "localStorage", {
  value: storageShim,
  writable: true,
  configurable: true,
});
