import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../store/auth.store";
import { AuthHydrator } from "./AuthHydrator";

vi.mock("../services/auth.service", () => ({
  me: vi.fn(),
}));

const mockUser = {
  id: "user-1",
  email: "user@example.com",
  name: "Nguyen Van A",
  role: "USER" as const,
  emailVerifiedAt: null,
};

describe("AuthHydrator", () => {
  afterEach(() => {
    useAuthStore.getState().clearUser();
    vi.resetAllMocks();
  });

  it("sets the user in store when /auth/me resolves", async () => {
    const { me } = await import("../services/auth.service");
    vi.mocked(me).mockResolvedValue(mockUser);

    render(<AuthHydrator />);

    await waitFor(() => expect(useAuthStore.getState().user).toEqual(mockUser));
  });

  it("keeps user as null when /auth/me rejects (chưa đăng nhập)", async () => {
    const { me } = await import("../services/auth.service");
    vi.mocked(me).mockRejectedValue(new Error("Unauthorized"));

    render(<AuthHydrator />);

    await waitFor(() => expect(vi.mocked(me)).toHaveBeenCalled());
    expect(useAuthStore.getState().user).toBeNull();
  });
});
