import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ExplorerDataSource, SqlQueryResult, SqlResource } from "../data/ExplorerDataSource";
import { sdkMockSpaces } from "../data/sdkMockSeed";
import { SqlWorkspace } from "./SqlWorkspace";

afterEach(cleanup);

it("keeps an unknown total distinct from a cached two-row preview", async () => {
  const space = sdkMockSpaces.find((candidate) => candidate.name === "listen")!;
  const resource = space.resources.find(
    (candidate): candidate is SqlResource =>
      candidate.kind === "sql" && candidate.name === "conversations",
  )!;
  const table = resource.tables.find((candidate) => candidate.name === "utterances")!;
  const runQuery = vi.fn(async () => ({
    columns: table.columns,
    rows: table.rows,
    elapsedMs: 2,
  }));
  const dataSource = { runQuery } as unknown as ExplorerDataSource;
  render(
    <SqlWorkspace
      space={space}
      resource={{
        ...resource,
        tables: [{ ...table, rowCount: null, loaded: false, columns: [], rows: [] }],
      }}
      initialMode="table"
      dataSource={dataSource}
      onBack={() => {}}
    />,
  );

  await waitFor(() => expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(2));
  expect(screen.getByText("2 preview rows · total unknown")).toBeVisible();
  expect(screen.getByText("Showing 2 preview rows · live TinyCloud data")).toBeVisible();
  expect(screen.getByText("Total unknown")).toBeVisible();

  const filter = screen.getByRole("searchbox", { name: "Filter tables" });
  fireEvent.change(filter, { target: { value: "no-match-audit-only" } });
  expect(screen.getByText("Clear the filter to see all tables.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "No matching tables" })).toBeVisible();
  fireEvent.change(filter, { target: { value: "" } });
  expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(2);
  expect(screen.getByText("2 preview rows · total unknown")).toBeVisible();
  expect(runQuery).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole("searchbox", { name: "Filter rows" }), {
    target: { value: "no-match-audit-only" },
  });
  expect(screen.getByText("0 of 2 preview rows · total unknown")).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy rows" })).toBeDisabled();
  fireEvent.change(screen.getByRole("searchbox", { name: "Filter rows" }), {
    target: { value: "" },
  });
  expect(screen.getByText("2 preview rows · total unknown")).toBeVisible();
  expect(runQuery).toHaveBeenCalledTimes(1);
});

it("labels a one-row loaded preview in the singular", () => {
  const space = sdkMockSpaces.find((candidate) => candidate.name === "listen")!;
  const resource = space.resources.find(
    (candidate): candidate is SqlResource =>
      candidate.kind === "sql" && candidate.name === "conversations",
  )!;
  const table = resource.tables.find((candidate) => candidate.name === "utterances")!;
  render(
    <SqlWorkspace
      space={space}
      resource={{ ...resource, tables: [{ ...table, rows: table.rows.slice(0, 1) }] }}
      initialMode="table"
      dataSource={{} as ExplorerDataSource}
      onBack={() => {}}
    />,
  );

  expect(screen.getByText("1 preview row · 3,982,114 total")).toBeVisible();
});

it("keeps a pending automatic preview when a table filter temporarily hides it", async () => {
  const space = sdkMockSpaces.find((candidate) => candidate.name === "listen")!;
  const resource = space.resources.find(
    (candidate): candidate is SqlResource =>
      candidate.kind === "sql" && candidate.name === "conversations",
  )!;
  const table = resource.tables.find((candidate) => candidate.name === "utterances")!;
  let resolvePreview!: (preview: SqlQueryResult) => void;
  const pending = new Promise<SqlQueryResult>((resolve) => {
    resolvePreview = resolve;
  });
  const runQuery = vi.fn(() => pending);
  render(
    <SqlWorkspace
      space={space}
      resource={{
        ...resource,
        tables: [{ ...table, rowCount: null, loaded: false, columns: [], rows: [] }],
      }}
      initialMode="table"
      dataSource={{ runQuery } as unknown as ExplorerDataSource}
      onBack={() => {}}
    />,
  );

  await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));
  const filter = screen.getByRole("searchbox", { name: "Filter tables" });
  fireEvent.change(filter, { target: { value: "no-match-audit-only" } });
  expect(screen.getByRole("heading", { name: "No matching tables" })).toBeVisible();
  fireEvent.change(filter, { target: { value: "" } });
  expect(runQuery).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolvePreview({ columns: table.columns, rows: table.rows, elapsedMs: 2 });
  });
  expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(2);
  expect(screen.getByText("2 preview rows · total unknown")).toBeVisible();
  expect(runQuery).toHaveBeenCalledTimes(1);
});
