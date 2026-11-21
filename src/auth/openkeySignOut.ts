import type { SignOutAcknowledgement } from "@openkey/sdk";

export interface OpenKeySignOutClient {
  signOut(): Promise<SignOutAcknowledgement>;
}

/**
 * How long Explorer waits for OpenKey's sign-out. It opens a widget that waits for the person to press "Sign out",
 * and the SDK reports no progress, so the wait is long. Explorer's own sign-out never waits on it.
 */
export const OPENKEY_SIGN_OUT_TIMEOUT_MS = 120_000;

/** Shown after Disconnect when OpenKey confirmed that it ended a renewal. */
export const RENEWAL_STOPPED_NOTICE = "Signed out of Explorer in this browser. Explorer's access won't renew.";

/** Shown after Disconnect when OpenKey did not confirm that it ended the renewal. */
export const RENEWAL_MAY_BE_ON_NOTICE =
  "You're signed out of Explorer in this browser, but OpenKey may still be renewing its access. To stop that, choose Stop renewal under Renewing permissions in OpenKey settings.";

/**
 * Signs the browser out of OpenKey, which ends the renewal lease OpenKey recorded for this sign-in. web-sdk's own
 * `signOut` only clears the local session and never calls OpenKey. The call is capped at 120 seconds and counts as
 * ended only on `revoked === true`: any other answer, a cancel, a refusal or a timeout means a lease may remain.
 */
export async function endOpenKeyRenewal(
  client: OpenKeySignOutClient,
  timeoutMs = OPENKEY_SIGN_OUT_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Executor form: the project's TypeScript lib predates Promise.withResolvers.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("OpenKey sign-out timed out")), timeoutMs);
  });
  try {
    const acknowledgement = await Promise.race([
      Promise.resolve().then(() => client.signOut()),
      deadline,
    ]);
    return acknowledgement.revoked === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
