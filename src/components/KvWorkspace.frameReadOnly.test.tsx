// Inside TinyCloud One, Explorer reads `applications` only (TC-3675): it never asks One for put or del there, and a
// read-only resource offers to open Explorer in its own tab instead of a write panel.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { KvResource } from "../data/ExplorerDataSource";
import { sdkMockSpaces } from "../data/sdkMockSeed";
import { embeddedPermissionsFor } from "../embed/embeddedSession";
import { KvWorkspace } from "./KvWorkspace";

afterEach(cleanup);

const space = sdkMockSpaces.find((candidate) => candidate.name === "listen")!;
const resource = space.resources.find((candidate): candidate is KvResource => candidate.kind === "kv")!;

function renderWorkspace(access: KvResource["access"], onEditOutside?: () => void) {
  return render(
    <KvWorkspace
      space={space}
      resource={{ ...resource, access }}
      onBack={vi.fn()}
      ownerAddress="0x1234567890AbCdEf1234567890aBcDeF1234AbCd"
      onWriteEntry={vi.fn(async () => {})}
      onDeleteEntry={vi.fn(async () => {})}
      onEditOutside={onEditOutside}
    />,
  );
}

it("asks One for no write or delete on applications", () => {
  const actions = embeddedPermissionsFor("applications").flatMap((entry) => entry.actions);
  expect(actions).not.toContain("tinycloud.kv/put");
  expect(actions).not.toContain("tinycloud.kv/del");
  expect(actions).not.toContain("tinycloud.sql/write");
  expect(actions).toContain("tinycloud.kv/get");
  expect(actions).toContain("tinycloud.kv/list");
});

it("in the frame, a read-only resource offers Explorer in its own tab and no write or delete", () => {
  const open = vi.fn();
  renderWorkspace("read-only", open);

  expect(screen.queryByRole("region", { name: "Write key" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Explorer" }));
  expect(open).toHaveBeenCalledTimes(1);
});

it("outside the frame, or where writing is allowed, there is no Open Explorer", () => {
  renderWorkspace("read-only");
  expect(screen.queryByRole("button", { name: "Open Explorer" })).toBeNull();
  cleanup();
  renderWorkspace("read-write", vi.fn());
  expect(screen.queryByRole("button", { name: "Open Explorer" })).toBeNull();
  expect(screen.getByRole("region", { name: "Write key" })).toBeInTheDocument();
});
