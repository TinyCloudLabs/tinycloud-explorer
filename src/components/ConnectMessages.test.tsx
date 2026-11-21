import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RENEWAL_MAY_BE_ON_NOTICE, RENEWAL_STOPPED_NOTICE } from "../auth/openkeySignOut";
import { ConnectMessages, disconnectMessages } from "./ConnectMessages";

afterEach(cleanup);

describe("the connect screen after a Disconnect", () => {
  it("shows OpenKey's confirmation that the renewal stopped as a status, not an alert", () => {
    const { error, notice } = disconnectMessages({ notice: RENEWAL_STOPPED_NOTICE, confirmed: true });
    render(<ConnectMessages error={error} notice={notice} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Signed out of Explorer in this browser. Explorer's access won't renew.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an unconfirmed stop as an alert, not a status", () => {
    const { error, notice } = disconnectMessages({ notice: RENEWAL_MAY_BE_ON_NOTICE, confirmed: false });
    render(<ConnectMessages error={error} notice={notice} />);

    expect(screen.getByRole("alert")).toHaveTextContent("OpenKey may still be renewing its access");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows nothing when the Disconnect had no sign of a lease", () => {
    const { error, notice } = disconnectMessages({});
    render(<ConnectMessages error={error} notice={notice} />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(disconnectMessages(undefined)).toEqual({ error: "", notice: "" });
  });
});
