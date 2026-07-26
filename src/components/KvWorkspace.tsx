import {
  Braces,
  ChevronLeft,
  Copy,
  FileJson,
  KeyRound,
  LockKeyhole,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  KvEntry,
  KvResource,
  TinyCloudSpace,
} from "../data/ExplorerDataSource";

interface KvWorkspaceProps {
  space: TinyCloudSpace;
  resource: KvResource;
  onBack: () => void;
}

function ValueView({ entry }: { entry: KvEntry }) {
  const rendered =
    typeof entry.value === "string"
      ? entry.value
      : JSON.stringify(entry.value, null, 2);
  return (
    <pre className="value-view" data-testid="kv-value">
      <code>{rendered}</code>
    </pre>
  );
}

export function KvWorkspace({
  space,
  resource,
  onBack,
}: KvWorkspaceProps) {
  const [selectedKey, setSelectedKey] = useState(
    resource.entries[0]?.key ?? "",
  );
  const [tab, setTab] = useState<"value" | "metadata">("value");
  const selectedEntry = useMemo(
    () =>
      resource.entries.find((entry) => entry.key === selectedKey) ??
      resource.entries[0],
    [resource.entries, selectedKey],
  );

  return (
    <section
      className="resource-workspace kv-workspace"
      aria-labelledby="resource-heading"
      data-testid="kv-workspace"
    >
      <header className="resource-workspace__header">
        <button type="button" className="back-button" onClick={onBack}>
          <ChevronLeft aria-hidden="true" size={18} />
          Back to {space.name}
        </button>
        <div className="resource-heading">
          <KeyRound aria-hidden="true" size={22} />
          <div>
            <h1 id="resource-heading">{resource.name}</h1>
            <code>{resource.path}</code>
          </div>
        </div>
        <span className="tc-status tc-status--success">encrypted</span>
      </header>

      <div className="kv-layout">
        <aside className="inner-rail kv-keys" aria-label="Key-value entries">
          <label className="inner-search">
            <Search aria-hidden="true" size={15} />
            <span className="sr-only">Filter keys</span>
            <input type="search" placeholder="Filter keys" />
          </label>
          <ul>
            {resource.entries.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  className={selectedEntry?.key === entry.key ? "is-selected" : ""}
                  onClick={() => setSelectedKey(entry.key)}
                >
                  <FileJson aria-hidden="true" size={16} />
                  <span>
                    <strong>{entry.key.split("/").at(-1)}</strong>
                    <small>{entry.contentType}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {selectedEntry ? (
          <div className="kv-surface">
            <div className="kv-header">
              <div>
                <code>{selectedEntry.key}</code>
                <span>{selectedEntry.contentType}</span>
              </div>
              <button type="button" className="tc-button tc-button--compact">
                <Copy aria-hidden="true" size={14} />
                Copy value
              </button>
            </div>
            <div className="resource-tabs" role="tablist" aria-label="KV entry view">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "value"}
                onClick={() => setTab("value")}
              >
                <Braces aria-hidden="true" size={16} />
                Value
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "metadata"}
                onClick={() => setTab("metadata")}
              >
                <LockKeyhole aria-hidden="true" size={16} />
                Metadata
              </button>
            </div>
            {tab === "value" ? (
              <ValueView entry={selectedEntry} />
            ) : (
              <dl className="kv-metadata">
                <div>
                  <dt>Content type</dt>
                  <dd>{selectedEntry.contentType}</dd>
                </div>
                <div>
                  <dt>Content ID</dt>
                  <dd>
                    <code>{selectedEntry.cid}</code>
                  </dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{selectedEntry.size.toLocaleString()} bytes</dd>
                </div>
                <div>
                  <dt>Encryption</dt>
                  <dd>{selectedEntry.encrypted ? "Encrypted" : "Plaintext"}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(selectedEntry.updatedAt))}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        ) : (
          <div className="query-empty">
            <KeyRound aria-hidden="true" size={28} />
            <h2>No keys found</h2>
            <p>This resource has no visible keys for the active session.</p>
          </div>
        )}
      </div>
    </section>
  );
}
