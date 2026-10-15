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
import { useEffect, useMemo, useState } from "react";
import type {
  ExplorerDataSource,
  SqlQueryResult,
  SqlResource,
  SqlTable,
  TinyCloudSpace,
} from "../data/ExplorerDataSource";

type SqlMode = "table" | "query";

interface DataTableProps {
  table: Pick<SqlTable, "columns" | "rows" | "concealed">;
  label: string;
  rows?: SqlTable["rows"];
}

function DataTable({ table, label, rows = table.rows }: DataTableProps) {
  if (table.concealed) {
    return (
      <div className="query-empty">
        <Database aria-hidden="true" size={28} />
        <h2>Needs additional permission</h2>
        <p>The table name is visible, but the active session cannot read it yet.</p>
      </div>
    );
  }

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
          {rows.map((row, rowIndex) => (
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

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
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
  const [tableFilter, setTableFilter] = useState("");
  const [rowFilter, setRowFilter] = useState("");
  const filteredTables = useMemo(() => {
    const term = tableFilter.trim().toLowerCase();
    return term
      ? resource.tables.filter((table) => table.name.toLowerCase().includes(term))
      : resource.tables;
  }, [resource.tables, tableFilter]);
  const selectedTable = useMemo(
    () =>
      filteredTables.find((table) => table.name === selectedTableName) ??
      filteredTables[0],
    [filteredTables, selectedTableName],
  );
  const [tablePreviews, setTablePreviews] = useState<Record<string, SqlTable>>(
    {},
  );
  const [tableState, setTableState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [tableError, setTableError] = useState("");
  const cachedPreview = selectedTable
    ? tablePreviews[selectedTable.name]
    : undefined;
  const visibleTable = cachedPreview ?? selectedTable;
  const hasRowFilter = rowFilter.trim().length > 0;
  const totalLabel = selectedTable?.rowCount == null
    ? "total unknown"
    : `${selectedTable.rowCount.toLocaleString()} total rows`;
  const filteredRows = useMemo(() => {
    if (!visibleTable) return [];
    const term = rowFilter.trim().toLowerCase();
    return term
      ? visibleTable.rows.filter((row) =>
          visibleTable.columns.some((column) => {
            const value = row[column.name];
            return (value === null ? "NULL" : String(value))
              .toLowerCase()
              .includes(term);
          }),
        )
      : visibleTable.rows;
  }, [visibleTable, rowFilter]);
  const [query, setQuery] = useState(
    resource.cannedQueries[0]?.sql ?? "SELECT 1;",
  );
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [queryState, setQueryState] = useState<
    "idle" | "running" | "error" | "success"
  >("idle");
  const [queryError, setQueryError] = useState("");

  useEffect(() => {
    if (mode !== "table" || !selectedTable || selectedTable.loaded !== false || cachedPreview) return;
    let active = true;
    setTableState("loading");
    setTableError("");
    void dataSource
      .runQuery(
        space.id,
        resource.id,
        `SELECT * FROM ${quoteIdentifier(selectedTable.name)} LIMIT 20`,
      )
      .then((preview) => {
        if (!active) return;
        setTablePreviews((current) => ({
          ...current,
          [selectedTable.name]: {
            ...selectedTable,
            columns: preview.columns,
            rows: preview.rows,
            loaded: true,
          },
        }));
        setTableState("idle");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setTableState("error");
        setTableError(
          error instanceof Error ? error.message : "The table preview could not be loaded.",
        );
      });
    return () => {
      active = false;
    };
  }, [cachedPreview, dataSource, mode, resource.id, selectedTable, space.id]);

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
        <span className="tc-status tc-status--success">
          {resource.access === "read-write"
            ? "read + write permission"
            : "read only permission"}
        </span>
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

      {mode === "table" && (
        <div className="sql-table-layout">
          <aside className="inner-rail" aria-label="SQL tables">
            <label className="inner-search">
              <Search aria-hidden="true" size={15} />
              <span className="sr-only">Filter tables</span>
              <input
                type="search"
                placeholder="Filter tables"
                value={tableFilter}
                onChange={(event) => setTableFilter(event.target.value)}
              />
            </label>
            <ul>
              {filteredTables.map((table) => (
                <li key={table.name}>
                  <button
                    type="button"
                    className={
                      selectedTable?.name === table.name ? "is-selected" : ""
                    }
                    onClick={() => setSelectedTableName(table.name)}
                  >
                    <Table2 aria-hidden="true" size={15} />
                    <span>
                      <strong>{table.name}</strong>
                      <small>
                        {table.concealed
                          ? "Needs additional permission"
                          : table.rowCount === null
                            ? "Total unknown"
                            : `${table.rowCount.toLocaleString()} total rows`}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className="table-surface">
            {selectedTable && visibleTable ? (
              <>
                <div className="table-toolbar">
                  <div>
                    <strong>{selectedTable.name}</strong>
                    <span>
                      {visibleTable.concealed
                        ? "Needs additional permission"
                        : visibleTable.loaded === false
                          ? tableState === "loading"
                            ? "Loading preview…"
                            : "Preview unavailable"
                          : `${filteredRows.length.toLocaleString()} ${
                              hasRowFilter ? "matching " : ""
                            }preview rows · ${totalLabel}`}
                    </span>
                  </div>
                  <label className="table-filter">
                    <Search aria-hidden="true" size={15} />
                    <span className="sr-only">Filter rows</span>
                    <input
                      type="search"
                      placeholder="Filter visible rows"
                      value={rowFilter}
                      onChange={(event) => setRowFilter(event.target.value)}
                    />
                  </label>
                  <button type="button" className="tc-button tc-button--compact">
                    <Copy aria-hidden="true" size={14} />
                    Copy rows
                  </button>
                </div>
                {visibleTable.loaded !== false &&
                !visibleTable.concealed &&
                filteredRows.length === 0 ? (
                  <div className="query-empty">
                    <Database aria-hidden="true" size={28} />
                    <h2>{hasRowFilter ? "No matching rows" : "No preview rows"}</h2>
                    <p>
                      {hasRowFilter
                        ? "No loaded preview rows match this filter."
                        : "This table has no rows in the loaded preview."}
                    </p>
                  </div>
                ) : (
                  <DataTable
                    table={visibleTable}
                    rows={filteredRows}
                    label={`${selectedTable.name} table rows`}
                  />
                )}
                {tableState === "error" &&
                  visibleTable.loaded === false &&
                  !cachedPreview &&
                  tableError && (
                    <p className="inline-error" role="alert">
                      {tableError}
                    </p>
                  )}
                <div className="table-status">
                  {visibleTable.concealed
                    ? "Table exists, but the active session does not have permission to read it."
                    : visibleTable.loaded === false
                      ? tableState === "loading"
                        ? "Loading a live preview…"
                        : "Preview unavailable."
                      : `Showing ${filteredRows.length}${
                          hasRowFilter ? ` of ${visibleTable.rows.length}` : ""
                        } preview rows · live TinyCloud data`}
                </div>
              </>
            ) : (
              <div className="query-empty">
                <Database aria-hidden="true" size={28} />
                <h2>{tableFilter.trim() ? "No matching tables" : "No tables found"}</h2>
                <p>
                  {tableFilter.trim()
                    ? "No loaded table names match this filter."
                    : "No tables are visible for this resource."}
                </p>
              </div>
            )}
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
