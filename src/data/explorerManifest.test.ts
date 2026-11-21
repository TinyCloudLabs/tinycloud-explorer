import { describe, expect, it } from "vitest";
import { createExplorerManifest, openkeyManifestFile } from "./explorerManifest";

// OpenKey hashes the published file and compares it with the digest of the
// manifest Explorer signs in with; any difference shows the sign-in as unsigned.
describe("openkeyManifestFile", () => {
  it.each(["applications", "team-notes", "public"])(
    "publishes exactly the sign-in manifest for space %s",
    (space) => {
      const published = JSON.parse(openkeyManifestFile(space));
      expect(published).toStrictEqual(JSON.parse(JSON.stringify(createExplorerManifest(space))));
      expect(published).toStrictEqual(createExplorerManifest(space));
    },
  );
});
