export type ExplorerFailureKind =
  | "cancelled-auth"
  | "denied-capability"
  | "expired-session"
  | "network-error"
  | "unsupported-resource"
  | "empty-space"
  | "unknown";

export class ExplorerDataSourceError extends Error {
  constructor(
    public readonly kind: ExplorerFailureKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "ExplorerDataSourceError";
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isExplorerDataSourceError(
  error: unknown,
): error is ExplorerDataSourceError {
  return error instanceof Error && error.name === "ExplorerDataSourceError";
}

export function explorerError(
  kind: ExplorerFailureKind,
  message: string,
  cause?: unknown,
): ExplorerDataSourceError {
  return new ExplorerDataSourceError(kind, message, { cause });
}

export function classifyExplorerFailure(error: unknown): ExplorerFailureKind {
  if (isExplorerDataSourceError(error)) return error.kind;
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  if (code === "USER_CANCELLED") return "cancelled-auth";
  if (code === "AUTH_EXPIRED") return "expired-session";
  if (code === "PERMISSION_DENIED") return "denied-capability";
  if (code === "CAPABILITY_NOT_GRANTED") return "denied-capability";
  if (code === "NETWORK_ERROR" || code === "TIMEOUT") return "network-error";
  if (code === "ABORTED") return "cancelled-auth";
  if (error instanceof Error) {
    if (/cancelled|canceled/i.test(error.message)) return "cancelled-auth";
    if (/expired/i.test(error.message)) return "expired-session";
    if (/permission|denied/i.test(error.message)) return "denied-capability";
    if (/network|fetch|timeout/i.test(error.message)) return "network-error";
  }
  return "unknown";
}
