import type { OpenKey } from "@openkey/sdk";
import { pkhDid } from "@tinycloud/sdk-core";
import { admitOwnerRenewalLease } from "@tinycloud/sdk-core/delegations/renewal";
import { verifyOwnerRenewalLease } from "@tinycloud/sdk-core/delegations/renewal-receipt";
import { parseApprovalRenewal } from "@tinycloud/share-envelope/links";
import type {
  BrowserSessionStorage,
  Config as TinyCloudWebConfig,
  PersistedSessionData,
  TinyCloudWeb,
} from "@tinycloud/web-sdk";

/**
 * Opt-in renewing sign-in (TC-2933). By default Explorer signs in without any renewal ask and the session is finite.
 * When the owner opts in through the warning on the connect screen, the sign-in asks OpenKey for a lease of at most
 * seven days. OpenKey records the lease so the owner's stop in OpenKey settings can end it, but does not send it to
 * the node: right after sign-in this module checks it against the session record just saved, has the node admit it,
 * and only then keeps it as the session's receipt. The node stays the authority on whether the lease still renews.
 */

/** The longest standing access Explorer ever asks for (decision D7). */
export const RENEWAL_LEASE_SECONDS = 7 * 24 * 60 * 60;

/**
 * The renewal ask Explorer adds to every standalone sign-in request. It carries no `purpose`, so OpenKey's own
 * renewal box starts unticked: the owner chooses there, once, and OpenKey's "Renew sensitive access?" screen is the
 * warning.
 */
export const EXPLORER_RENEWAL_ASK = {
  version: 1,
  leaseLifetimeSeconds: RENEWAL_LEASE_SECONDS,
} as const;

/** Sign-ins are signed for one day at a time, so a lease has sessions to renew. */
export const RENEWING_SESSION_MS = 24 * 60 * 60 * 1000;

export interface RenewalAsk {
  version: 1;
  leaseLifetimeSeconds: number;
}

/** What OpenKey's sign-in result says about renewal. A sign-in without a lease leaves both out. */
export interface OpenKeyRenewalOutcome {
  renewalChoice?: unknown;
  /** The lease receipt OpenKey signed: unverified and not yet admitted at the node. */
  renewal?: unknown;
}

/** What the wrapped OpenKey client sent about renewal and saw come back, and when (this device's monotonic clock). */
export interface RenewalCapture {
  outcome: OpenKeyRenewalOutcome;
  arrivedAt?: number;
  /** The renewal ask went to OpenKey with this sign-in, so OpenKey may hold a lease if the owner ticked its box. */
  askSent?: boolean;
}

type OpenKeySignInClient = NonNullable<TinyCloudWebConfig["openkey"]>["client"];

/**
 * The OpenKey client the SDK's sign-in calls. It adds the renewal ask to OpenKey's request and records what comes
 * back about renewal in `capture` before the SDK builds the session from the signed result.
 */
export function openKeyRenewalClient(
  openkey: OpenKey,
  ask: RenewalAsk,
  capture: RenewalCapture,
): OpenKeySignInClient {
  return {
    authorizeTinyCloud: async (request, opts) => {
      capture.askSent = true;
      const result = await openkey.authorizeTinyCloud(
        { ...request, renewal: ask } as Parameters<OpenKey["authorizeTinyCloud"]>[0],
        opts,
      );
      const { renewalChoice, renewal } = result as OpenKeyRenewalOutcome;
      capture.outcome = { renewalChoice, renewal };
      capture.arrivedAt = performance.now();
      return result;
    },
  };
}

// The receipt lives outside the SDK's session prefix ("tinycloud-explorer"), which the SDK scans.
const RECEIPT_KEY_PREFIX = "xyz.tinycloud.explorer:renewal-receipt:";

function receiptKey(address: string): string {
  return RECEIPT_KEY_PREFIX + address.toLowerCase();
}

/** Keeps the receipt OpenKey returned. Unverified: check it against the session record before every use. */
export function saveRenewalReceipt(address: string, receipt: unknown): void {
  try {
    globalThis.localStorage.setItem(receiptKey(address), JSON.stringify(receipt));
  } catch {
    // Storage unavailable or full: the session then lasts until its signed end.
  }
}

/** The stored receipt, parsed but unverified; null when there is none or it is unreadable. */
export function loadRenewalReceipt(address: string): unknown {
  try {
    const raw = globalThis.localStorage.getItem(receiptKey(address));
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearRenewalReceipt(address: string): void {
  try {
    globalThis.localStorage.removeItem(receiptKey(address));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/**
 * The lease authorization in `value` when it is a well-formed receipt for `record`'s own grant, signed by the grant's
 * owner for that grant only, within the seven days Explorer asks for, and not yet ended; otherwise null. Never throws.
 */
export async function verifiedRenewalLease(
  value: unknown,
  record: PersistedSessionData,
): Promise<string | null> {
  try {
    const renewal = parseApprovalRenewal(value);
    const grant = record.tinycloudSession;
    if (!grant) return null;
    if (renewal.approvedLeaseLifetimeSeconds > RENEWAL_LEASE_SECONDS) return null;
    await verifyOwnerRenewalLease(
      {
        delegationHeader: grant.delegationHeader,
        delegationCid: grant.delegationCid,
        verificationMethod: grant.verificationMethod,
      },
      pkhDid(record.address, record.chainId),
      renewal,
    );
    return renewal.receipt.leaseAuthorization;
  } catch {
    return null;
  }
}

/** How long the sign-in waits for the node to admit the lease before going on without renewal. */
const ADMIT_TIMEOUT_MS = 5_000;
/**
 * The latest a lease is sent to the node after it arrived on this device. A stop at OpenKey leaves a sign-in lease it
 * cannot find at the node on for ten minutes in case the app is still admitting it; this keeps every admission well
 * inside that. Measured on this device's monotonic clock, never against OpenKey's `approvedAt`.
 */
const ADMIT_DEADLINE_MS = 60_000;

/**
 * Has the signed-in session's node admit the lease OpenKey returned, then keeps it as the session's receipt. The lease
 * must first check out against the session record the sign-in just saved, and is sent only within a minute of
 * `arrivedAt` (a `performance.now()` reading taken when OpenKey returned it). With no lease, or when the check, the
 * deadline or the admission fails, nothing is kept and the session lasts until its signed end. Resolves whether
 * renewal is on.
 */
export async function admitSignInRenewal(input: {
  tcw: Pick<TinyCloudWeb, "activeNodeIdentity">;
  address: string;
  renewal: unknown;
  arrivedAt: number | undefined;
  sessionStorage: Pick<BrowserSessionStorage, "load">;
}): Promise<boolean> {
  const { tcw, address, renewal, arrivedAt, sessionStorage } = input;
  if (renewal === undefined || renewal === null || arrivedAt === undefined) return false;
  try {
    const record = await sessionStorage.load(address);
    const grant = record?.tinycloudSession;
    const leaseAuthorization = record ? await verifiedRenewalLease(renewal, record) : null;
    if (!record || !grant || !leaseAuthorization) return false;
    const { receipt } = parseApprovalRenewal(renewal);
    const { origin } = await tcw.activeNodeIdentity();
    const remaining = arrivedAt + ADMIT_DEADLINE_MS - performance.now();
    if (!(remaining > 0)) return false;
    await admitOwnerRenewalLease({
      host: origin,
      originalAuthorization: grant.delegationHeader.Authorization.replace(/^Bearer\s+/i, ""),
      originalCid: grant.delegationCid,
      ownerDid: pkhDid(record.address, record.chainId),
      agentDid: grant.verificationMethod,
      spaceId: grant.spaceId,
      nodeIdentity: receipt.nodeIdentity,
      leaseAuthorization,
      leaseCid: receipt.leaseCid,
      leaseExpiresAt: receipt.leaseExpiresAt,
      signal: AbortSignal.timeout(Math.min(ADMIT_TIMEOUT_MS, remaining)),
    });
    // A sign-out during the admission cleared the record: keep no receipt beside a session that is gone.
    if ((await sessionStorage.load(address))?.tinycloudSession?.delegationCid !== grant.delegationCid) {
      return false;
    }
    saveRenewalReceipt(address, renewal);
    return true;
  } catch {
    return false;
  }
}

export interface RenewalRestore {
  address: string;
  leaseAuthorization: string;
}

/**
 * The lease to restore through, only when the saved session has a receipt of its own that checks out against the
 * saved record. Without a receipt the saved session is left to the plain restore.
 */
export async function renewalRestoreFor(
  storage: Pick<BrowserSessionStorage, "activeAddressForRenewal" | "loadRenewalCandidate">,
): Promise<RenewalRestore | null> {
  const address = storage.activeAddressForRenewal();
  if (!address) return null;
  const receipt = loadRenewalReceipt(address);
  if (receipt === null) return null;
  const candidate = await storage.loadRenewalCandidate(address);
  // Only a session past its signed end restores through the lease; a live one takes the plain restore.
  if (candidate.status !== "renewal-candidate") return null;
  const leaseAuthorization = await verifiedRenewalLease(receipt, candidate.data);
  return leaseAuthorization ? { address, leaseAuthorization } : null;
}

// What a failed fetch looks like per engine: Chromium, Firefox, Safari, undici.
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed|fetch failed|timed? ?out/i;

/** A network failure, timeout or 408/429/5xx answer: the node was not reached, so it said nothing about the session. */
export function isTransientRestoreError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current != null; depth++) {
    if (typeof current !== "object") return typeof current === "string" && NETWORK_FAILURE.test(current);
    if ("name" in current && (current.name === "AbortError" || current.name === "TimeoutError")) return true;
    if ("status" in current && typeof current.status === "number") {
      if (current.status >= 500 || current.status === 408 || current.status === 429) return true;
    }
    if ("message" in current && typeof current.message === "string") {
      if (NETWORK_FAILURE.test(current.message)) return true;
      if (/\bHTTP (5\d\d|408|429)\b/.test(current.message)) return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

/**
 * Whether a restore through the lease that did not come back `restored` ends the saved session and its receipt.
 * Only `restore-failed` carries an error from reaching the node, so only it can be transient, and an offline device
 * cannot tell the two apart. Every other status is the SDK's own verdict on the record (expired, revoked, missing,
 * corrupt, stale): a retry would not change it.
 */
export function renewalRestoreEnded(result: { status: string; error?: unknown }, offline: boolean): boolean {
  if (result.status !== "restore-failed") return true;
  return !(offline || isTransientRestoreError(result.error));
}

export function browserIsOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** True once the lease a receipt holds has passed its end, or when the receipt cannot say. */
export function renewalLeaseEnded(address: string, now = Date.now()): boolean {
  const stored = loadRenewalReceipt(address);
  if (typeof stored !== "object" || stored === null || !("receipt" in stored)) return true;
  const { receipt } = stored;
  if (typeof receipt !== "object" || receipt === null || !("leaseExpiresAt" in receipt)) return true;
  const end = Date.parse(String(receipt.leaseExpiresAt));
  return !Number.isFinite(end) || end <= now;
}

/**
 * A read-only EIP-1193 object for restoring a session. A restored client built without a provider reports no
 * `session()`. This answers the account and chain queries from the saved address and can sign nothing: every other
 * method throws EIP-1193 error 4200.
 */
export function readOnlyAccountProvider(storedAddress: string, chainId = 1) {
  return {
    request: async ({ method }: { method: string; params?: unknown[] }) => {
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (method === "eth_accounts") return [storedAddress];
      throw Object.assign(new Error(`Unsupported wallet method: ${method}`), { code: 4200 });
    },
    on: () => undefined,
    removeListener: () => undefined,
  };
}
