import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuditFeed } from "../../components/device/audit-feed";

describe("AuditFeed", () => {
  it("renders Recent security activity with newest-first ordering", () => {
    render(
      <AuditFeed
        events={[
          {
            id: "older",
            eventType: "approval.responded",
            subject: "request-123",
            outcome: "success",
            createdAt: "2026-04-18T12:00:00.000Z",
          },
          {
            id: "newer",
            eventType: "device.revoked",
            subject: "device-123",
            outcome: "success",
            createdAt: "2026-04-18T12:05:00.000Z",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Recent security activity" }),
    ).toBeInTheDocument();

    const articles = screen.getAllByRole("article");
    expect(within(articles[0]!).getByText("Device Revoked")).toBeInTheDocument();
    expect(within(articles[1]!).getByText("Approval Responded")).toBeInTheDocument();
  });
});
