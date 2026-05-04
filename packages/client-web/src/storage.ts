export type SessionMode = "cookie" | "header";

export interface SessionStorage {
  load(): string | null;
  save(token: string): void;
  clear(): void;
  attachToRequest(headers: Headers): void;
  readonly includeCredentials: boolean;
}

export interface SessionStorageOptions {
  storageKey?: string;
}

const DEFAULT_STORAGE_KEY = "passkey-sdk:session";

export function createSessionStorage(
  mode: SessionMode,
  opts: SessionStorageOptions = {}
): SessionStorage {
  if (mode === "cookie") {
    return {
      load: () => null,
      save: () => {},
      clear: () => {},
      attachToRequest: () => {},
      includeCredentials: true,
    };
  }
  const key = opts.storageKey ?? DEFAULT_STORAGE_KEY;
  return {
    load: () => localStorage.getItem(key),
    save: (token: string) => {
      localStorage.setItem(key, token);
    },
    clear: () => {
      localStorage.removeItem(key);
    },
    attachToRequest: (headers: Headers) => {
      const token = localStorage.getItem(key);
      if (token) headers.set("Authorization", `Bearer ${token}`);
    },
    includeCredentials: false,
  };
}
