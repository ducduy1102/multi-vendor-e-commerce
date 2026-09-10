import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useAuthStore } from "../store/auth.store";
import { CurrentUserBadge } from "./CurrentUserBadge";

describe("CurrentUserBadge", () => {
  afterEach(() => {
    // Unmount trước khi reset store — tránh setState "ngoài act()" trên
    // component của test trước (Zustand là module-level singleton).
    cleanup();
    useAuthStore.getState().clearUser();
  });

  it("shows 'Chưa đăng nhập' when there is no user", () => {
    render(<CurrentUserBadge />);

    expect(screen.getByText("Chưa đăng nhập")).toBeInTheDocument();
  });

  it("shows the user's email and role when logged in", () => {
    useAuthStore.getState().setUser({
      id: "user-1",
      email: "user@example.com",
      name: "Nguyen Van A",
      role: "ADMIN",
    });

    render(<CurrentUserBadge />);

    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/ADMIN/)).toBeInTheDocument();
  });
});
