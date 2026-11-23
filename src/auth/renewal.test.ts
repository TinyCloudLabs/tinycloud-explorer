// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
import { admitOwnerRenewalLease } from "@tinycloud/sdk-core/delegations/renewal";
import {
  RENEWAL_LEASE_SECONDS,
  admitSignInRenewal,
  loadRenewalReceipt,
  verifiedRenewalLease,
} from "./renewal";
import { OTHER_RENEWER, renewalFixture } from "./renewalReceipt.fixture";

vi.mock("@tinycloud/sdk-core/delegations/renewal", () => ({
  admitOwnerRenewalLease: vi.fn(async () => undefined),
}));

// Real wallet-signed SIWE CACAOs (renewalReceipt.fixture.ts): a receipt is checked the way the SDK checks a grant.

// The node environment: the SDK's CACAO decoder checks `instanceof Uint8Array`, which jsdom's realm fails.
const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    get length() {
      return values.size;
    },
  } as Storage;
  vi.mocked(admitOwnerRenewalLease).mockClear();
});

describe("a renewal receipt", () => {
  it("for the saved grant, signed by its owner for that grant's renewal alone, yields the lease", async () => {
    const { record, receipt, lease } = await renewalFixture();
    expect(await verifiedRenewalLease(receipt, record)).toBe(lease.authorization);
  });

  it("naming another grant is refused", async () => {
    const { record } = await renewalFixture();
    const other = await renewalFixture();
    expect(await verifiedRenewalLease(other.receipt, record)).toBeNull();
  });

  it("whose lease another wallet signed is refused", async () => {
    const { record, receipt } = await renewalFixture({ leaseSigner: Wallet.createRandom() });
    expect(await verifiedRenewalLease(receipt, record)).toBeNull();
  });

  it("for a grant whose owner is not the saved session's account is refused", async () => {
    const { record, receipt } = await renewalFixture();
    expect(
      await verifiedRenewalLease(receipt, { ...record, address: Wallet.createRandom().address }),
    ).toBeNull();
  });

  it("whose lease grants more than renewing that grant is refused", async () => {
    const { record, receipt } = await renewalFixture({ extraAbility: true });
    expect(await verifiedRenewalLease(receipt, record)).toBeNull();
  });

  it("whose lease names a renewer other than the receipt's is refused", async () => {
    const { record, receipt } = await renewalFixture({ leaseAudience: OTHER_RENEWER });
    expect(await verifiedRenewalLease(receipt, record)).toBeNull();
  });

  it("for longer than the seven days Explorer asks for is refused", async () => {
    const { record, receipt } = await renewalFixture({
      approvedLeaseLifetimeSeconds: RENEWAL_LEASE_SECONDS + 86_400,
    });
    expect(await verifiedRenewalLease(receipt, record)).toBeNull();
  });

  it("that is not a receipt at all is refused", async () => {
    const { record } = await renewalFixture();
    expect(await verifiedRenewalLease({ version: 1 }, record)).toBeNull();
    expect(await verifiedRenewalLease(null, record)).toBeNull();
  });
});

describe("admitting a sign-in's lease", () => {
  const tcw = { activeNodeIdentity: async () => ({ origin: "https://node.example", nodeDid: "did:key:z6MkNode" }) };

  it("keeps the receipt only after the node admitted a lease that checks out against the saved record", async () => {
    const { owner, record, receipt, lease } = await renewalFixture();
    const kept = await admitSignInRenewal({
      tcw: tcw as never,
      address: owner.address,
      renewal: receipt,
      arrivedAt: performance.now(),
      sessionStorage: { load: async () => record },
    });
    expect(kept).toBe(true);
    expect(admitOwnerRenewalLease).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "https://node.example",
        leaseAuthorization: lease.authorization,
        originalCid: record.tinycloudSession!.delegationCid,
      }),
    );
    expect(loadRenewalReceipt(owner.address)).toEqual(receipt);
  });

  it("refuses a lease for another grant: nothing reaches the node and nothing is kept", async () => {
    const { owner, record } = await renewalFixture();
    const { receipt: foreign } = await renewalFixture();
    const kept = await admitSignInRenewal({
      tcw: tcw as never,
      address: owner.address,
      renewal: foreign,
      arrivedAt: performance.now(),
      sessionStorage: { load: async () => record },
    });
    expect(kept).toBe(false);
    expect(admitOwnerRenewalLease).not.toHaveBeenCalled();
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });

  it("keeps nothing when the node refuses the lease", async () => {
    vi.mocked(admitOwnerRenewalLease).mockRejectedValueOnce(new Error("refused"));
    const { owner, record, receipt } = await renewalFixture();
    const kept = await admitSignInRenewal({
      tcw: tcw as never,
      address: owner.address,
      renewal: receipt,
      arrivedAt: performance.now(),
      sessionStorage: { load: async () => record },
    });
    expect(kept).toBe(false);
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });

  it("sends nothing to the node more than a minute after the lease arrived", async () => {
    const { owner, record, receipt } = await renewalFixture();
    const kept = await admitSignInRenewal({
      tcw: tcw as never,
      address: owner.address,
      renewal: receipt,
      arrivedAt: performance.now() - 61_000,
      sessionStorage: { load: async () => record },
    });
    expect(kept).toBe(false);
    expect(admitOwnerRenewalLease).not.toHaveBeenCalled();
  });

  it("keeps no receipt beside a session that a sign-out cleared during the admission", async () => {
    const { owner, record, receipt } = await renewalFixture();
    const load = vi.fn().mockResolvedValueOnce(record).mockResolvedValueOnce(null);
    const kept = await admitSignInRenewal({
      tcw: tcw as never,
      address: owner.address,
      renewal: receipt,
      arrivedAt: performance.now(),
      sessionStorage: { load },
    });
    expect(kept).toBe(false);
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });
});
