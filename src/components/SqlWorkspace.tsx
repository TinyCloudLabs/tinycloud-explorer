import {
  ChevronLeft,
  Clock3,
  Copy,
  Database,
  Play,
  Rows3,
  Search,
  Table2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ExplorerDataSource,
  SqlQueryResult,
  SqlResource,
  SqlTable,
  TinyCloudSpace,
} from "../data/ExplorerDataSource";

type SqlMode = "table" | "query";

interface DataTableProps {
  table: Pick<SqlTable, "columns" | "rows">;
  label: string;
}

function DataTable({ table, label }: DataTableProps) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column.name} scope="col">
                <span>{column.name}</span>
                <small>{column.type}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={String(row.id ?? rowIndex)}>
              {table.columns.map((column) => (
                <td key={column.name}>
                  {row[column.name] === null ? (
                    <span className="null-value">NULL</span>
                  ) : (
                    String(row[column.name])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SqlWorkspaceProps {
  space: TinyCloudSpace;
  resource: SqlResource;
  initialMode: SqlMode;
  dataSource: ExplorerDataSource;
  onBack: () => void;
}

export function SqlWorkspace({
  space,
  resource,
  initialMode,
  dataSource,
  onBack,
}: SqlWorkspaceProps) {
  const [mode, setMode] = useState<SqlMode>(initialMode);
  const [selectedTableName, setSelectedTableName] = useState(
    resource.tables[0]?.name ?? "",
  );
  const selectedTable = useMemo(
    () =>
      resource.tables.find((table) => table.name === selectedTableName) ??
      resource.tables[0],
    [resource.tables, selectedTableName],
  );
  const [query, setQuery] = useState(
    resource.cannedQueries[0]?.sql ?? "SELECT 1;",
  );
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [queryState, setQueryState] = useState<
    "idle" | "running" | "error" | "success"
  >("idle");
  const [queryError, setQueryError] = useState("");

  const runQuery = async () => {
    setQueryState("running");
    setQueryError("");
    try {
      const nextResult = await dataSource.runQuery(
        space.id,
        resource.id,
        query,
      );
      setResult(nextResult);
      setQueryState("success");
    } catch (error) {
      setQueryState("error");
      setQueryError(
        error instanceof Error ? error.message : "The query could not be run.",
      );
    }
  };

  return (
    <section
      className="resource-workspace sql-workspace"
      aria-labelledby="resource-heading"
      data-testid="sql-workspace"
    >
      <header className="resource-workspace__header">
        <button type="button" className="back-button" onClick={onBack}>
          <ChevronLeft aria-hidden="true" size={18} />
          Back to {space.name}
        </button>
        <div className="resource-heading">
          <Database aria-hidden="true" size={22} />
          <div>
            <h1 id="resource-heading">{resource.name}</h1>
            <code>{resource.path}</code>
          </div>
        </div>
        <span className="tc-status tc-status--success">read-only session</span>
      </header>

      <div className="resource-tabs" role="tablist" aria-label="SQL resource view">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "table"}
          onClick={() => setMode("table")}
        >
          <Table2 aria-hidden="true" size={17} />
          Tables
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "query"}
          onClick={() => setMode("query")}
        >
          <Rows3 aria-hidden="true" size={17} />
          Query
        </button>
      </div>

      {mode === "table" && selectedTable && (
        <div className="sql-table-layout">
          <aside className="inner-rail" aria-label="SQL tables">
            <label className="inner-search">
              <Search aria-hidden="true" size={15} />
              <span className="sr-only">Filter tables</span>
              <input type="search" placeholder="Filter tables" />
            </label>
            <ul>
              {resource.tables.map((table) => (
                <li key={table.name}>
                  <button
                    type="button"
                    className={
                      selectedTable.name === table.name ? "is-selected" : ""
                    }
                    onClick={() => setSelectedTableName(table.name)}
                  >
                    <Table2 aria-hidden="true" size={15} />
                    <span>
                      <strong>{table.name}</strong>
                      <small>{table.rowCount.toLocaleString()} rows</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className="table-surface">
            <div className="table-toolbar">
              <div>
                <strong>{selectedTable.name}</strong>
                <span>{selectedTable.rowCount.toLocaleString()} rows</span>
              </div>
              <label className="table-filter">
                <Search aria-hidden="true" size={15} />
                <span className="sr-only">Filter rows</span>
                <input type="search" placeholder="Filter visible rows" />
              </label>
              <button type="button" className="tc-button tc-button--compact">
                <Copy aria-hidden="true" size={14} />
                Copy rows
              </button>
            </div>
            <DataTable
              table={selectedTable}
              label={`${selectedTable.name} table rows`}
            />
            <div className="table-status">
              Showing {selectedTable.rows.length} preview rows · wireframe data
            </div>
          </div>
        </div>
      )}

      {mode === "query" && (
        <div className="query-layout">
          <aside className="inner-rail canned-queries" aria-label="Saved queries">
            <h2>Saved queries</h2>
            {resource.cannedQueries.map((cannedQuery) => (
              <button
                type="button"
                key={cannedQuery.id}
                onClick={() => setQuery(cannedQuery.sql)}
              >
                <span>
                  <strong>{cannedQuery.label}</strong>
                  <small>{cannedQuery.sql.split(/\s+/).slice(0, 5).join(" ")}…</small>
                </span>
              </button>
            ))}
          </aside>
          <div className="query-surface">
            <label className="query-editor">
              <span>SQL query</span>
              <textarea
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                spellCheck={false}
                aria-describedby="query-help query-error"
              />
            </label>
            <div className="query-actions">
              <span id="query-help">
                Read-only · press <kbd>⌘</kbd><kbd>Return</kbd> to run
              </span>
              <button
                type="button"
                className="tc-button tc-button--primary"
                onClick={runQuery}
                disabled={queryState === "running"}
                data-testid="run-query"
              >
                <Play aria-hidden="true" size={15} />
                {queryState === "running" ? "Running…" : "Run query"}
              </button>
            </div>
            {queryError && (
              <p id="query-error" className="inline-error" role="alert">
                {queryError}
              </p>
            )}
            {result && (
              <div className="query-results" aria-live="polite">
                <div className="query-results__header">
                  <strong>{result.rows.length} rows</strong>
                  <span>
                    <Clock3 aria-hidden="true" size={14} />
                    {result.elapsedMs} ms
                  </span>
                </div>
                <DataTable table={result} label="SQL query results" />
              </div>
            )}
            {!result && queryState !== "error" && (
              <div className="query-empty">
                <Rows3 aria-hidden="true" size={28} />
                <h2>Results appear here</h2>
                <p>
                  Run the selected read-only query to inspect rows without
                  leaving the resource.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
