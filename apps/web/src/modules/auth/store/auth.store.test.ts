import { afterEach, describe, expect, it } from "vitest";

import { useAuthStore } from "./auth.store";

const mockUser = {
  id: "user-1",
  email: "user@example.com",
  name: "Nguyen Van A",
  role: "USER" as const,
};

describe("useAuthStore", () => {
  afterEach(() => {
    useAuthStore.getState().clearUser();
  });

  it("starts with no user", () => {
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("setUser stores the given user", () => {
    useAuthStore.getState().setUser(mockUser);

    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it("clearUser resets user back to null", () => {
    useAuthStore.getState().setUser(mockUser);
    useAuthStore.getState().clearUser();

    expect(useAuthStore.getState().user).toBeNull();
  });
});
