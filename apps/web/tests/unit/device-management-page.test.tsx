import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const devicePageMocks = vi.hoisted(() => ({
  requireRemotePrincipal: vi.fn(),
  relayInternalFetch: vi.fn(),
  listDeviceSessionsForUser: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  useRouter: () => ({
    refresh: devicePageMocks.refresh,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("../../lib/live-session/server", () => ({
  requireRemotePrincipal: devicePageMocks.requireRemotePrincipal,
  relayInternalFetch: devicePageMocks.relayInternalFetch,
}));

vi.mock("@codex-mobile/db", () => ({
  listDeviceSessionsForUser: devicePageMocks.listDeviceSessionsForUser,
}));

import DevicesPage from "../../app/devices/page";

describe("DevicesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    devicePageMocks.requireRemotePrincipal.mockResolvedValue({
      userId: "user-123",
      deviceSessionId: "device-session-123",
    });
    devicePageMocks.listDeviceSessionsForUser.mockResolvedValue([
      {
        id: "device-session-123",
        deviceLabel: "Pocket phone",
        devicePublicId: "public-123",
        createdAt: new Date("2026-04-18T10:00:00.000Z"),
        expiresAt: new Date("2026-04-25T10:00:00.000Z"),
        lastSeenAt: new Date("2026-04-18T11:00:00.000Z"),
        revokedAt: null,
      },
    ]);
    devicePageMocks.relayInternalFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          sessions: [
            {
              sessionId: "session-123",
              title: "Resume relay routing pass",
              model: "gpt-5-codex",
              status: "Live",
              turnCount: 18,
              updatedAt: "2026-04-18T11:15:00.000Z",
              updatedLabel: "just now",
            },
          ],
        }),
        { status: 200 },
      ),
    );
  });

  it("renders Paired devices, Active remote sessions, and Revoke device in the phone-sized page", async () => {
    render(await DevicesPage());

    expect(
      screen.getByRole("heading", { name: "Paired devices" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Active remote sessions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Revoke device" }),
    ).toBeInTheDocument();
  });
});
