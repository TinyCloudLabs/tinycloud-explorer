import { Check, Copy, Terminal, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ExplorerLogEntry } from "../data/debugLog";

interface DebugLogPanelProps {
  entryTheme?: boolean;
  entries: ExplorerLogEntry[];
  onClear: () => void;
  onClose: () => void;
}

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(new Date(timestamp));
}

export function serializeExplorerLogs(entries: ExplorerLogEntry[]) {
  return entries
    .map((entry) => {
      const details = entry.details
        ? ` ${JSON.stringify(entry.details)}`
        : "";
      return `${entry.timestamp} ${entry.level.toUpperCase()} [${entry.scope}] ${entry.message}${details}`;
    })
    .join("\n");
}

export function DebugLogPanel({
  entryTheme = false,
  entries,
  onClear,
  onClose,
}: DebugLogPanelProps) {
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "instant",
    });
  }, [entries]);

  const copyLogs = async () => {
    await navigator.clipboard.writeText(serializeExplorerLogs(entries));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <aside
      className={entryTheme ? "debug-log debug-log--entry" : "debug-log"}
      aria-label="TinyCloud Explorer debug log"
      data-testid="debug-log"
    >
      <header className="debug-log__header">
        <div>
          <Terminal aria-hidden="true" size={17} />
          <span>
            <strong>Session debug log</strong>
            <small>
              {entries.length} events · request timings + HTTP status · sensitive fields redacted
            </small>
          </span>
        </div>
        <div className="debug-log__actions">
          <button
            type="button"
            className="tc-button tc-button--compact"
            onClick={copyLogs}
            disabled={entries.length === 0}
          >
            {copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
            {copied ? "Copied" : "Copy logs"}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Clear debug log"
            onClick={onClear}
            disabled={entries.length === 0}
          >
            <Trash2 aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Close debug log"
            onClick={onClose}
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      </header>

      {entries.length === 0 ? (
        <div className="debug-log__empty">
          <Terminal aria-hidden="true" size={22} />
          <p>Connection, discovery, permission, and invocation events appear here.</p>
        </div>
      ) : (
        <ol className="debug-log__entries" ref={listRef}>
          {entries.map((entry) => (
            <li key={entry.id} className={`is-${entry.level}`}>
              <time dateTime={entry.timestamp}>{formatTime(entry.timestamp)}</time>
              <span className="debug-log__level">{entry.level}</span>
              <code>{entry.scope}</code>
              <div>
                <strong>{entry.message}</strong>
                {entry.details && <pre>{JSON.stringify(entry.details, null, 2)}</pre>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
