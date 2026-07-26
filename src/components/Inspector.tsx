import {
  ArrowUpRight,
  Calendar,
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
}: InspectorProps) {
  const ResourceIcon = resource?.kind === "kv" ? KeyRound : Database;

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
          <span className="tc-badge">{resource?.access ?? space.access}</span>
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
            {resource && (
              <>
                <div>
                  <dt>Granted by</dt>
                  <dd>
                    <code>{resource.grantedBy}</code>
                  </dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>
                    <Calendar aria-hidden="true" size={15} />
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                    }).format(new Date(resource.expiresAt))}
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
                  <dd>{formatBytes(resource.size)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(resource.updatedAt))}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </section>

        <section className="trust-note">
          <ShieldCheck aria-hidden="true" size={19} />
          <div>
            <strong>Source-backed boundary</strong>
            <p>
              This view is limited to the abilities carried by the active
              session and its verified delegation chain.
            </p>
          </div>
        </section>
      </div>

      <footer className="inspector__actions">
        {resource?.kind === "sql" && (
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
        {resource?.kind === "kv" && (
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
