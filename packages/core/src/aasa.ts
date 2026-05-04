import type { AasaInput } from "./types.js";

export interface AppleAppSiteAssociation {
  webcredentials: { apps: string[] };
}

export function appleAppSiteAssociation(input: AasaInput): AppleAppSiteAssociation {
  return { webcredentials: { apps: input.appIds.slice() } };
}
