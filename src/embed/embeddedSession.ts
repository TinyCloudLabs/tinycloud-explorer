// Explorer's embedded (framed in TinyCloud One) data session. One delegates one
// space at a time to this frame's in-memory session key; each delegation
// becomes a `DelegatedAccess` that the data source uses in place of the
// wallet-backed `tcw.kvForSpace` / `tcw.sqlForSpace`. No wallet, no OpenKey
// popup, nothing persisted.
import { buildSpaceUri } from "@tinycloud/sdk-core";
import {
  TinyCloudWeb,
  deserializeDelegation,
  type DelegatedAccess,
  type PermissionEntry,
} from "@tinycloud/web-sdk";
import { explorerError } from "../data/explorerErrors";
import { explorerLog } from "../data/debugLog";
import {
  EXPLORER_APP_ID,
  createOneEmbedController,
  type EmbedGrant,
  type EmbedRequestResult,
  type EmbedTheme,
  type OneEmbedController,
  type OneEmbedControllerOptions,
} from "./oneEmbed";

/** Spaces Explorer browses; One's grant for any other space is ignored. */
export const EXPLORER_EMBEDDED_SPACES = ["applications", "public", "secrets"] as const;

/** How long to wait for One's first silent grant before showing the signed-out state. */
export const EMBED_FIRST_GRANT_TIMEOUT_MS = 15_000;

/**
 * What Explorer asks One for, per space, kept inside the ceiling One holds for
 * Explorer (anything outside it is denied outright). `space` is a short name or
 * a space id; One resolves either.
 */
export function embeddedPermissionsFor(space: string): PermissionEntry[] {
  const name = space.slice(space.lastIndexOf(":") + 1);
  const kv = (path: string, actions: string[]): PermissionEntry => ({
    service: "tinycloud.kv",
    space,
    path,
    actions: actions.map((action) => `tinycloud.kv/${action}`),
  });
  const sql = (actions: string[]): PermissionEntry => ({
    service: "tinycloud.sql",
    space,
    path: "default",
    actions: actions.map((action) => `tinycloud.sql/${action}`),
  });
  switch (name) {
    case "applications":
      return [kv("", ["get", "list", "put", "del"]), sql(["read", "schema"])];
    case "public":
      return [kv("", ["get", "list", "metadata"])];
    case "secrets":
      return [
        sql(["read"]),
        kv("", ["list"]),
        kv("vault/secrets", ["get", "list", "metadata"]),
        kv("variables", ["get", "list", "metadata"]),
      ];
    default:
      return [];
  }
}

export interface EmbeddedOwner {
  address: string;
  chainId: number;
  did: string;
}

type EmbeddedKv = DelegatedAccess["kv"];

/**
 * `DelegatedAccess.kv` prefixes every key with `delegation.path`, which is a
 * single path even when the grant covers several. Explorer works in absolute
 * keys, so get/put/delete pass an empty prefix. `list` already takes an
 * absolute prefix.
 */
export interface AbsoluteKv {
  list: EmbeddedKv["list"];
  get: EmbeddedKv["get"];
  put: EmbeddedKv["put"];
  delete: EmbeddedKv["delete"];
}

export function absoluteKv(kv: EmbeddedKv): AbsoluteKv {
  return {
    list: (options) => kv.list(options),
    get: ((key: string, options?: object) =>
      kv.get(key, { ...options, prefix: "" })) as EmbeddedKv["get"],
    put: ((key: string, value: unknown, options?: object) =>
      kv.put(key, value, { ...options, prefix: "" })) as EmbeddedKv["put"],
    delete: ((key: string, options?: object) =>
      kv.delete(key, { ...options, prefix: "" })) as EmbeddedKv["delete"],
  };
}

export interface EmbeddedSessionConfig {
  win: Window;
  /** Validated One origin from `resolveOneParentOrigin`. */
  parentOrigin: string;
  tinycloudHost: string;
  onTheme?: (theme: EmbedTheme) => void;
  onRevoked?: () => void;
  firstGrantTimeoutMs?: number;
  /** Test seams. */
  createTinyCloudWeb?: () => Promise<TinyCloudWeb>;
  createController?: (options: OneEmbedControllerOptions) => OneEmbedController;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface FirstGrantWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

export class OneEmbedSession {
  private tcw_: TinyCloudWeb | null = null;
  private controller: OneEmbedController | null = null;
  private owner_: EmbeddedOwner | null = null;
  private readonly access = new Map<string, DelegatedAccess>();
  private readonly actions = new Map<string, Set<string>>();
  private applyQueue: Promise<void> = Promise.resolve();
  private waiter: FirstGrantWaiter | null = null;
  private starting: Promise<void> | null = null;
  private cancelTimeout: (() => void) | null = null;
  private baseRequested = false;

  constructor(private readonly config: EmbeddedSessionConfig) {}

  get tcw(): TinyCloudWeb {
    if (!this.tcw_) throw explorerError("expired-session", "TinyCloud session expired. Sign in again.");
    return this.tcw_;
  }

  get owner(): EmbeddedOwner | null {
    return this.owner_;
  }

  grantedSpaceIds(): string[] {
    return [...this.access.keys()];
  }

  accessFor(spaceId: string): DelegatedAccess | undefined {
    return this.access.get(spaceId);
  }

  /** Union of the actions One delegated for a space (empty if not granted). */
  actionsFor(spaceId: string): string[] {
    return [...(this.actions.get(spaceId) ?? [])];
  }

  /**
   * Create the session-only TinyCloudWeb once, say hello, and resolve when One's
   * first usable grant is applied. Rejects if One denies, revokes or stays
   * silent past the timeout. Calling again after a failure repeats hello with
   * the same session key: One fixes one session DID per frame.
   */
  start(): Promise<void> {
    if (this.access.size > 0) return Promise.resolve();
    this.starting ??= this.handshake().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async handshake(): Promise<void> {
    const { config } = this;
    const setTimer = config.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer =
      config.clearTimer ??
      ((handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));

    let controller = this.controller;
    const firstHello = controller === null;
    if (!controller) {
      const tcw = config.createTinyCloudWeb
        ? await config.createTinyCloudWeb()
        : await TinyCloudWeb.create({
            persistSession: false,
            tinycloudHosts: [config.tinycloudHost],
            tinycloudFallbackHosts: null,
            tinycloudRegistryUrl: null,
            autoDiscoverLocalNode: false,
            autoCreateSpace: false,
          });
      this.tcw_ = tcw;
      const create = config.createController ?? createOneEmbedController;
      controller = create({
        win: config.win,
        parentOrigin: config.parentOrigin,
        appId: EXPLORER_APP_ID,
        sessionDid: tcw.sessionDid,
        onGrant: (grant) => this.enqueueGrant(grant),
        onDenied: () =>
          this.failFirstGrant(
            explorerError("denied-capability", "TinyCloud One denied the access request."),
          ),
        onRevoke: () => {
          this.clear();
          this.failFirstGrant(
            explorerError("expired-session", "TinyCloud session expired. Sign in again."),
          );
          config.onRevoked?.();
        },
        onTheme: (theme) => config.onTheme?.(theme),
      });
      this.controller = controller;
    }

    const first = new Promise<void>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
    const timeout = setTimer(() => {
      this.failFirstGrant(
        explorerError("expired-session", "TinyCloud One did not grant access in time."),
      );
    }, config.firstGrantTimeoutMs ?? EMBED_FIRST_GRANT_TIMEOUT_MS);
    this.cancelTimeout = () => clearTimer(timeout);

    if (firstHello) controller.start();
    else controller.repeatHello();
    try {
      await first;
    } finally {
      clearTimer(timeout);
    }
  }

  private failFirstGrant(error: Error) {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(error);
  }

  private enqueueGrant(grant: EmbedGrant) {
    this.config.onTheme?.(grant.theme);
    this.applyQueue = this.applyQueue.then(async () => {
      await this.applyGrant(grant);
      if (this.access.size === 0 && this.waiter && this.controller) {
        this.answerEmptyFirstGrant(this.controller);
      }
    });
  }

  /**
   * One answered the hello with no spaces (it holds nothing for Explorer
   * silently). Ask once for Explorer's base scope so One shows its ask card;
   * after a denial only a user action asks again, so a later empty grant fails
   * the connect instead of asking again.
   */
  private answerEmptyFirstGrant(controller: OneEmbedController) {
    this.cancelTimeout?.();
    if (this.baseRequested) {
      this.failFirstGrant(
        explorerError("denied-capability", "TinyCloud One denied the access request."),
      );
      return;
    }
    this.baseRequested = true;
    void controller.request(embeddedPermissionsFor("applications")).then(
      async (result) => {
        if (result.kind === "denied") {
          this.failFirstGrant(
            explorerError("denied-capability", "TinyCloud One denied the access request."),
          );
          return;
        }
        if (result.kind === "grant") await this.applyQueue;
        if (this.access.size === 0) {
          this.failFirstGrant(
            explorerError("denied-capability", "TinyCloud One denied the access request."),
          );
        }
      },
    );
  }

  private async applyGrant(grant: EmbedGrant): Promise<void> {
    const tcw = this.tcw_;
    if (!tcw) return;
    for (const entry of grant.grants) {
      try {
        const delegation = deserializeDelegation(entry.delegation);
        const owner: EmbeddedOwner = {
          address: delegation.ownerAddress,
          chainId: delegation.chainId,
          did: `did:pkh:eip155:${delegation.chainId}:${delegation.ownerAddress}`,
        };
        if (
          this.owner_ &&
          (this.owner_.chainId !== owner.chainId ||
            this.owner_.address.toLowerCase() !== owner.address.toLowerCase())
        ) {
          throw new Error("grant belongs to a different owner");
        }
        const spaceId = EXPLORER_EMBEDDED_SPACES.map((name) =>
          buildSpaceUri(owner.did, name),
        ).find((candidate) => candidate.toLowerCase() === entry.spaceId.toLowerCase());
        if (!spaceId) throw new Error("grant is for a space Explorer does not browse");

        const access = await tcw.useDelegation(delegation);
        if (access.spaceId.toLowerCase() !== spaceId.toLowerCase()) {
          throw new Error("delegation space does not match the grant");
        }
        this.owner_ ??= owner;
        this.access.set(spaceId, access);
        const granted = new Set<string>(delegation.actions ?? []);
        for (const resource of delegation.resources ?? []) {
          for (const action of resource.actions ?? []) granted.add(action);
        }
        this.actions.set(spaceId, granted);
      } catch (error) {
        explorerLog("warn", "embed", "Ignored a delegation from One", {
          spaceId: entry.spaceId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (this.access.size > 0) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter?.resolve();
    }
  }

  /** Ask One for more access. A grant is applied before this resolves. */
  async request(permissions: PermissionEntry[]): Promise<EmbedRequestResult> {
    const controller = this.controller;
    if (!controller) return { kind: "revoked" };
    const result = await controller.request(permissions);
    if (result.kind === "grant") await this.applyQueue;
    return result;
  }

  private clear() {
    this.access.clear();
    this.actions.clear();
    this.owner_ = null;
    this.tcw_ = null;
  }

  /** Drop the session key and every delegation. */
  stop() {
    this.controller?.stop();
    this.controller = null;
    this.clear();
    this.failFirstGrant(
      explorerError("expired-session", "TinyCloud session expired. Sign in again."),
    );
    this.starting = null;
  }
}
