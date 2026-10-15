import {
  ArrowUpRight,
  Calendar,
  CircleCheck,
  CircleX,
  Copy,
  Database,
  KeyRound,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  TinyCloudResource,
  TinyCloudSpace,
} from "../data/ExplorerDataSource";

interface InspectorProps {
  space: TinyCloudSpace;
  resource: TinyCloudResource | null;
  onCloseResource: () => void;
  onOpenResource: (resourceId: string, mode: "table" | "query" | "value") => void;
  onGrantPermission: (resourceId: string) => void;
  grantState: "idle" | "granting" | "granted" | "error";
  grantError: string;
}

function formatBytes(bytes: number) {
  return new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: bytes >= 1_000_000 ? "megabyte" : "kilobyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(bytes / (bytes >= 1_000_000 ? 1_000_000 : 1_000));
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={() => navigator.clipboard?.writeText(value)}
    >
      <Copy aria-hidden="true" size={15} />
    </button>
  );
}

export function Inspector({
  space,
  resource,
  onCloseResource,
  onOpenResource,
  onGrantPermission,
  grantState,
  grantError,
}: InspectorProps) {
  const ResourceIcon = resource?.kind === "kv" ? KeyRound : Database;
  const needsPermission = resource?.access === "needs-permission";
  const accessLabel =
    resource?.access === "read-write"
      ? "read + write"
      : resource?.access === "needs-permission"
        ? "Needs additional permission"
        : "read only";

  return (
    <aside
      className="inspector"
      aria-label={resource ? `${resource.name} inspector` : `${space.name} inspector`}
      data-testid="inspector"
    >
      <header className="inspector__header">
        <div className="inspector__title">
          <ResourceIcon aria-hidden="true" size={22} />
          <div>
            <h2>{resource ? `${space.name} / ${resource.name}` : space.name}</h2>
            <span>{resource ? "Resource inspector" : "Space inspector"}</span>
          </div>
        </div>
        {resource && (
          <button
            type="button"
            className="icon-button"
            aria-label="Close resource inspector"
            onClick={onCloseResource}
          >
            <X aria-hidden="true" size={18} />
          </button>
        )}
      </header>

      <div className="inspector__content">
        <div className="badge-row">
          <span className="tc-badge tc-badge--mono">
            {resource?.kind.toUpperCase() ?? "SPACE"}
          </span>
          <span className="tc-badge">
            {resource ? accessLabel : space.access}
          </span>
          <span className="tc-status tc-status--success">verified</span>
        </div>

        <section className="inspector__section">
          <h3>Access</h3>
          <dl className="metadata-list">
            <div>
              <dt>Path</dt>
              <dd>
                <code>{resource?.path ?? space.uri}</code>
                <CopyButton
                  value={resource?.path ?? space.uri}
                  label="Copy TinyCloud path"
                />
              </dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>
                <code>{space.owner.replace(/(.{18}).+(.{6})/, "$1…$2")}</code>
              </dd>
            </div>
            {resource && !needsPermission && (
              <>
                <div>
                  <dt>Granted by</dt>
                  <dd>
                    {resource.grantedBy ? <code>{resource.grantedBy}</code> : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>
                    {resource.expiresAt ? (
                      <>
                        <Calendar aria-hidden="true" size={15} />
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                        }).format(new Date(resource.expiresAt))}
                      </>
                    ) : "Unknown"}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </section>

        <section className="inspector__section">
          <h3>{resource ? "Resource" : "Space"}</h3>
          <dl className="metadata-list">
            <div>
              <dt>Type</dt>
              <dd>{resource?.kind.toUpperCase() ?? "TinyCloud space"}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{resource?.name ?? space.name}</dd>
            </div>
            <div>
              <dt>Resources</dt>
              <dd>{space.resourceCount.toLocaleString()}</dd>
            </div>
            {resource && (
              <>
                <div>
                  <dt>Size</dt>
                  <dd>{resource.size === null ? "Unknown" : formatBytes(resource.size)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>
                    {resource.updatedAt
                      ? new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(resource.updatedAt))
                      : "Unknown"}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </section>

        {resource && needsPermission && (
          <section
            className="inspector__section permission-section"
            aria-labelledby="effective-permissions-heading"
          >
            <div className="permission-section__heading">
              <div>
                <h3 id="effective-permissions-heading">
                  Additional permission required
                </h3>
                <p>
                  This resource exists, but the active session cannot read its
                  contents yet.
                </p>
              </div>
            </div>
            <dl className="permission-list">
              {(
                [
                  ["list", resource.permissions.list],
                  ["describe", resource.permissions.describe],
                  ["read", resource.permissions.read],
                  ["write", resource.permissions.write],
                  ["query", resource.permissions.query],
                ] as const
              ).map(([permission, allowed]) => (
                <div key={permission}>
                  <dt>{permission}</dt>
                  <dd className={allowed ? "is-allowed" : "is-denied"}>
                    {allowed ? (
                      <CircleCheck aria-hidden="true" size={15} />
                    ) : (
                      <CircleX aria-hidden="true" size={15} />
                    )}
                    {allowed ? "Allowed" : "Not allowed"}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section className="trust-note">
          <ShieldCheck aria-hidden="true" size={19} />
          <div>
            <strong>Source-backed boundary</strong>
            <p>
              {needsPermission
                ? "OpenKey and TinyCloud can see that this resource exists, but the current session does not have the capability needed to reveal it."
                : "This view is limited to the abilities carried by the active session and its verified delegation chain."}
            </p>
          </div>
        </section>
      </div>

      <footer className="inspector__actions">
        {resource && needsPermission && (
          <button
            type="button"
            className="tc-button tc-button--primary"
            data-testid="grant-permission"
            disabled={
              grantState === "granting" || !resource.permissions.grant
            }
            onClick={() => onGrantPermission(resource.id)}
          >
            <KeyRound aria-hidden="true" size={16} />
            {grantState === "granting" ? "Requesting…" : "Request access"}
          </button>
        )}
        {grantError && (
          <p className="inspector__action-error" role="alert">
            {grantError}
          </p>
        )}
        {resource?.kind === "sql" && !needsPermission && (
          <>
            <button
              type="button"
              className="tc-button tc-button--primary"
              data-testid="open-table"
              onClick={() => onOpenResource(resource.id, "table")}
            >
              Open table
              <ArrowUpRight aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              className="tc-button"
              data-testid="open-query"
              onClick={() => onOpenResource(resource.id, "query")}
            >
              Open query
            </button>
          </>
        )}
        {resource?.kind === "kv" && !needsPermission && (
          <button
            type="button"
            className="tc-button tc-button--primary"
            data-testid="open-value"
            onClick={() => onOpenResource(resource.id, "value")}
          >
            Inspect values
            <ArrowUpRight aria-hidden="true" size={16} />
          </button>
        )}
        {!resource && (
          <span className="inspector__hint">
            Select a resource on the map to inspect its access and contents.
          </span>
        )}
      </footer>
    </aside>
  );
}
