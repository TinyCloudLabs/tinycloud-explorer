import { ethers } from "ethers";
import type { AuthResult } from "@openkey/sdk";
import {
  REAL_FIXTURE_ADDRESS,
  REAL_FIXTURE_PRIVATE_KEY,
} from "../src/data/realFixture";

type ProviderRequest = {
  method: string;
  params?: unknown[];
};

declare global {
  interface Window {
    __tinycloudExplorerConnectOpenKey?: () => Promise<AuthResult>;
  }
}

export function installAgentBrowserWallet(): {
  address: string;
  hookInstalled: boolean;
} {
  const wallet = new ethers.Wallet(REAL_FIXTURE_PRIVATE_KEY);
  const provider = {
    isMetaMask: true,
    selectedAddress: REAL_FIXTURE_ADDRESS,
    chainId: "0x1",
    networkVersion: "1",
    async request({ method, params = [] }: ProviderRequest) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [REAL_FIXTURE_ADDRESS];
        case "eth_chainId":
          return "0x1";
        case "net_version":
          return "1";
        case "eth_getBalance":
          return "0x56bc75e2d63100000";
        case "eth_blockNumber":
          return "0x1";
        case "eth_getCode":
        case "eth_call":
          return "0x";
        case "eth_estimateGas":
          return "0x5208";
        case "personal_sign": {
          const message = params[0];
          if (typeof message !== "string") {
            throw new Error("Missing personal_sign message.");
          }
          return message.startsWith("0x")
            ? wallet.signMessage(ethers.utils.arrayify(message))
            : wallet.signMessage(message);
        }
        case "eth_signTypedData_v4": {
          const typed = JSON.parse(String(params[1]));
          return wallet._signTypedData(
            typed.domain,
            typed.types,
            typed.message,
          );
        }
        case "wallet_getPermissions":
        case "wallet_requestPermissions":
          return [{ parentCapability: "eth_accounts" }];
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;
        default:
          return null;
      }
    },
    on: () => provider,
    removeListener: () => provider,
    isConnected: () => true,
    send(method: string, params?: unknown[]) {
      return provider.request({ method, params });
    },
    sendAsync(
      payload: ProviderRequest,
      callback: (error: Error | null, response?: { result?: unknown }) => void,
    ) {
      provider
        .request(payload)
        .then((result) => callback(null, { result }))
        .catch((error) => callback(error));
    },
  };

  Object.defineProperty(window, "ethereum", {
    value: provider,
    configurable: true,
  });
  window.__tinycloudExplorerConnectOpenKey = async () => ({
    address: REAL_FIXTURE_ADDRESS,
    keyId: "external-key",
    keyType: "EXTERNAL",
  });

  return {
    address: REAL_FIXTURE_ADDRESS,
    hookInstalled: true,
  };
}
