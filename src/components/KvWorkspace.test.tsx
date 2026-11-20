import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { KvResource } from "../data/ExplorerDataSource";
import { sdkMockIdentity, sdkMockSpaces } from "../data/sdkMockSeed";
import { KvWorkspace } from "./KvWorkspace";

afterEach(cleanup);

const owner = "0x1234567890AbCdEf1234567890aBcDeF1234AbCd";
const space = sdkMockSpaces.find((candidate) => candidate.name === "listen")!;
const writable = space.resources.find(
  (candidate): candidate is KvResource =>
    candidate.kind === "kv" && candidate.access === "read-write",
)!;

function renderWorkspace(resource: KvResource) {
  return render(
    <KvWorkspace
      space={space}
      resource={resource}
      onBack={vi.fn()}
      ownerAddress={owner}
      onWriteEntry={vi.fn(async () => {})}
      onDeleteEntry={vi.fn(async () => {})}
    />,
  );
}

it("names the owner the write is bound to before any put or delete", () => {
  renderWorkspace(writable);

  const panel = screen.getByRole("region", { name: "Write key" });
  const actor = panel.querySelector(".kv-write-panel__actor");
  expect(actor).toHaveTextContent(/^Acting as 0x1234…AbCd$/);
  expect(actor).toBeVisible();
  expect(screen.getByText("0x1234…AbCd")).toHaveAttribute("title", owner);
  expect(actor?.textContent).not.toContain("did:");
  expect(actor?.textContent).not.toContain(sdkMockIdentity.sessionDid);

  expect(screen.getByRole("button", { name: "Write entry" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
});

it("shows no write panel or owner line for a read-only resource", () => {
  renderWorkspace({ ...writable, access: "read-only" });

  expect(screen.queryByRole("region", { name: "Write key" })).toBeNull();
  expect(screen.queryByText(/Acting as/)).toBeNull();
});

it("never hides the owner line at any viewport width", () => {
  const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
  const hiddenSelectors = [...css.matchAll(/([^{}]+)\{[^{}]*display:\s*none/g)].map(
    ([, selector]) => selector.trim(),
  );
  expect(hiddenSelectors.length).toBeGreaterThan(0);
  for (const selector of hiddenSelectors) {
    expect(selector).not.toMatch(/kv-write-panel|query-empty|kv-workspace|resource-workspace/);
  }
});
