import { Info, TriangleAlert } from "lucide-react";
import type { DisconnectResult } from "../data/ExplorerDataSource";

/**
 * What the connect screen tells the person: an error or warning (`role="alert"`) and, separately, a neutral status
 * (`role="status"`) such as the confirmation that a renewal stopped. A confirmed stop is not an error.
 */
export function ConnectMessages({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && (
        <p className="inline-error" role="alert">
          <TriangleAlert aria-hidden="true" size={18} />
          {error}
        </p>
      )}
      {notice && (
        <p className="connect-notice" role="status">
          <Info aria-hidden="true" size={18} />
          {notice}
        </p>
      )}
    </>
  );
}

/** Where a Disconnect's notice goes: OpenKey's confirmation is a status, an unconfirmed stop is a warning. */
export function disconnectMessages(result: DisconnectResult | void): { error: string; notice: string } {
  if (!result?.notice) return { error: "", notice: "" };
  return result.confirmed ? { error: "", notice: result.notice } : { error: result.notice, notice: "" };
}
