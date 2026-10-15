import {
  Braces,
  ChevronLeft,
  Copy,
  FileJson,
  FilePenLine,
  KeyRound,
  LockKeyhole,
  Trash2,
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
  onWriteEntry: (key: string, value: unknown) => Promise<void>;
  onDeleteEntry: (key: string) => Promise<void>;
}

function ValueView({ entry }: { entry: KvEntry }) {
  if (entry.hidden) {
    return (
      <div className="query-empty">
        <KeyRound aria-hidden="true" size={28} />
        <h2>Needs additional permission</h2>
        <p>The key is visible, but the active session cannot read its value.</p>
      </div>
    );
  }
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
  onWriteEntry,
  onDeleteEntry,
}: KvWorkspaceProps) {
  const [selectedKey, setSelectedKey] = useState(
    resource.entries[0]?.key ?? "",
  );
  const [tab, setTab] = useState<"value" | "metadata">("value");
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [actionState, setActionState] = useState<"idle" | "writing" | "deleting">("idle");
  const [actionError, setActionError] = useState("");
  const selectedEntry = useMemo(
    () =>
      resource.entries.find((entry) => entry.key === selectedKey) ??
      resource.entries[0],
    [resource.entries, selectedKey],
  );
  const canWrite = resource.access === "read-write";

  const writeEntry = async () => {
    if (!canWrite) return;
    setActionState("writing");
    setActionError("");
    try {
      const nextKey = draftKey.trim();
      if (!nextKey) {
        throw new Error("A key name is required.");
      }
      let parsedValue: unknown = "";
      if (draftValue.trim().length > 0) {
        try {
          parsedValue = JSON.parse(draftValue);
        } catch {
          parsedValue = draftValue;
        }
      }
      await onWriteEntry(nextKey, parsedValue);
      setDraftKey("");
      setDraftValue("");
      setSelectedKey(
        resource.path ? `${resource.path}/${nextKey}` : nextKey,
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The value could not be written.",
      );
    } finally {
      setActionState("idle");
    }
  };

  const deleteEntry = async () => {
    if (!selectedEntry) return;
    setActionState("deleting");
    setActionError("");
    try {
      await onDeleteEntry(selectedEntry.key);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The value could not be deleted.",
      );
    } finally {
      setActionState("idle");
    }
  };

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
      </header>

      {canWrite && (
        <section className="query-empty kv-write-panel" aria-label="Write key">
          <div className="kv-write-panel__heading">
            <FilePenLine aria-hidden="true" size={22} />
            <div>
              <h2>Write entry</h2>
              <p>Store a real key inside this TinyCloud KV resource.</p>
            </div>
          </div>
          <div className="kv-write-form">
            <label>
              <span>Key</span>
              <input
                type="text"
                placeholder="e2e/example.json"
                value={draftKey}
                onChange={(event) => setDraftKey(event.target.value)}
              />
            </label>
            <label>
              <span>Value</span>
              <textarea
                placeholder='{"message":"hello"}'
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="tc-button tc-button--primary"
              onClick={writeEntry}
              disabled={actionState !== "idle" || !draftKey.trim()}
            >
              {actionState === "writing" ? "Writing…" : "Write entry"}
            </button>
          </div>
          {actionError && (
            <p className="inline-error" role="alert">
              {actionError}
            </p>
          )}
        </section>
      )}

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
                  aria-label={entry.key}
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
              {canWrite && (
                <button
                  type="button"
                  className="tc-button tc-button--compact"
                  onClick={deleteEntry}
                  disabled={actionState !== "idle"}
                >
                  <Trash2 aria-hidden="true" size={14} />
                  {actionState === "deleting" ? "Deleting…" : "Delete"}
                </button>
              )}
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
                  <dd>{selectedEntry.size === null ? "Unknown" : `${selectedEntry.size.toLocaleString()} bytes`}</dd>
                </div>
                <div>
                  <dt>Encryption</dt>
                  <dd>
                    {selectedEntry.encrypted === null
                      ? "Unknown"
                      : selectedEntry.encrypted
                        ? "Encrypted"
                        : "Plaintext"}
                  </dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>
                    {selectedEntry.updatedAt
                      ? new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(selectedEntry.updatedAt))
                      : "Unknown"}
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
