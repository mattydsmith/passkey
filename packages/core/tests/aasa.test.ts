import { describe, it, expect } from "vitest";
import { appleAppSiteAssociation } from "../src/aasa.js";

describe("appleAppSiteAssociation", () => {
  it("returns webcredentials.apps with the given app IDs", () => {
    const json = appleAppSiteAssociation({ appIds: ["TEAMID.com.example.MyApp"] });
    expect(json.webcredentials.apps).toEqual(["TEAMID.com.example.MyApp"]);
  });

  it("supports multiple app IDs", () => {
    const json = appleAppSiteAssociation({
      appIds: ["TEAMID.com.example.A", "TEAMID.com.example.B"],
    });
    expect(json.webcredentials.apps).toHaveLength(2);
  });

  it("returns an empty array when given no apps", () => {
    expect(appleAppSiteAssociation({ appIds: [] }).webcredentials.apps).toEqual([]);
  });
});
