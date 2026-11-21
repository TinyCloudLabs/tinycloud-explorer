// What Explorer asks OpenKey for at sign-in. Pure (type-only SDK imports) so
// the build can publish the same manifest at /.well-known/openkey-manifest.json.
import type { Manifest, PermissionEntry } from "@tinycloud/web-sdk";
import {
  REAL_FIXTURE_PUBLIC_SPACE,
  REAL_FIXTURE_SECRETS_SPACE,
} from "./realFixture";

export function createExplorerManifest(space = "applications"): Manifest {
  const permissions: PermissionEntry[] = [
    {
      service: "tinycloud.kv",
      space: REAL_FIXTURE_PUBLIC_SPACE,
      path: "",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
    },
    {
      service: "tinycloud.sql",
      space: REAL_FIXTURE_SECRETS_SPACE,
      path: "default",
      actions: ["tinycloud.sql/read"],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: REAL_FIXTURE_SECRETS_SPACE,
      path: "",
      actions: ["tinycloud.kv/list"],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: REAL_FIXTURE_SECRETS_SPACE,
      path: "vault/secrets",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: REAL_FIXTURE_SECRETS_SPACE,
      path: "variables",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    },
  ];

  if (space !== "public" && space !== "secrets") {
    permissions.unshift(
      {
        service: "tinycloud.kv",
        space,
        path: "",
        actions: [
          "tinycloud.kv/get",
          "tinycloud.kv/list",
          "tinycloud.kv/put",
          "tinycloud.kv/del",
        ],
      },
      {
        service: "tinycloud.sql",
        space,
        path: "default",
        actions: ["tinycloud.sql/read", "tinycloud.sql/schema"],
      },
    );
  }

  return {
    app_id: "xyz.tinycloud.explorer",
    name: "TinyCloud Explorer",
    description: "Spatial browser for TinyCloud spaces, SQL tables, and KV data.",
    appVersion: "0.1.0",
    space: "applications",
    defaults: true,
    includePublicSpace: true,
    prefix: "",
    permissions,
  };
}

/** The file OpenKey fetches from /.well-known/openkey-manifest.json: the sign-in manifest for this build's space. */
export function openkeyManifestFile(space: string): string {
  return `${JSON.stringify(createExplorerManifest(space), null, 2)}\n`;
}
