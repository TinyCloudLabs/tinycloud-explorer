import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectScreen } from "./App";

afterEach(cleanup);

describe("the connect screen", () => {
  it("shows no renewal control and no renewal text: the choice is made in OpenKey", () => {
    const { container } = render(
      <ConnectScreen
        connectionState="disconnected"
        error=""
        notice=""
        mode="real"
        onConnect={() => undefined}
        logCount={0}
        onOpenLogs={() => undefined}
      />,
    );

    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/renew|signed in for up to|7 days/i);
  });
});
