import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ExplorerDataSource, SqlResource } from "../data/ExplorerDataSource";
import { sdkMockSpaces } from "../data/sdkMockSeed";
import { SqlWorkspace } from "./SqlWorkspace";

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
