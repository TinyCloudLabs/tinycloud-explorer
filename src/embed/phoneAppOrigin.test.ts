import { describe, expect, it } from "vitest";
import { frameAncestorsFor } from "./framing";
import { isOneOrigin, resolveOneParentOrigin } from "./oneEmbed";

// TC-3045 moves One's phone app to its own origins. Builds from before the move stay installed, so Explorer accepts
// both pairs as parent, exactly.
const NEW_IOS = "tinycloudone://app.tinycloud.one";
const NEW_ANDROID = "https://app.tinycloud.one";
const LEGACY = ["capacitor://localhost", "https://localhost"];
const framed = { isFramed: true, search: "?embed=one" };

describe("One's phone app on its own origin", () => {
  it("accepts the new and the legacy phone origins and refuses near misses", () => {
    for (const origin of [NEW_IOS, NEW_ANDROID, ...LEGACY]) expect(isOneOrigin(origin)).toBe(true);
    for (const origin of [
      "http://app.tinycloud.one",
      "https://app.tinycloud.one:8443",
      "https://app.tinycloud.one/",
      "capacitor://app.tinycloud.one",
      "tinycloudone://localhost",
      "tinycloudone://evil.example",
      "tinycloudone://app.tinycloud.one.evil.example",
      "https://evil.app.tinycloud.one",
    ]) {
      expect(isOneOrigin(origin)).toBe(false);
    }
  });

  it("iOS (no referrer) takes the new origin from ancestorOrigins", () => {
    expect(resolveOneParentOrigin({ ...framed, referrer: "", ancestorOrigin: NEW_IOS })).toBe(NEW_IOS);
  });

  it("Android takes the new origin from the referrer", () => {
    expect(resolveOneParentOrigin({ ...framed, referrer: "https://app.tinycloud.one/chat/apps/xyz.tinycloud.explorer" })).toBe(NEW_ANDROID);
  });

  it("a foreign referrer is refused even when ancestorOrigins names the new origin", () => {
    expect(resolveOneParentOrigin({ ...framed, referrer: "https://evil.test/", ancestorOrigin: NEW_IOS })).toBeNull();
  });

  it("the production frame-ancestors carry both new origins", () => {
    expect(frameAncestorsFor("production")).toEqual(expect.arrayContaining([NEW_IOS, NEW_ANDROID]));
  });
});
