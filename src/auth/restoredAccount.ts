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
