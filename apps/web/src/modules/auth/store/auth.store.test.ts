import { afterEach, describe, expect, it } from "vitest";

import { useAuthStore } from "./auth.store";

const mockUser = {
  id: "user-1",
  email: "user@example.com",
  name: "Nguyen Van A",
  role: "USER" as const,
  emailVerifiedAt: null,
};

describe("useAuthStore", () => {
  afterEach(() => {
    useAuthStore.getState().clearUser();
    // Reset về default true — vài test isHydrating bên dưới tự hạ cờ, module
    // store là singleton dùng chung giữa các test trong cùng file.
    useAuthStore.getState().setIsHydrating(true);
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

  it("starts with isHydrating true", () => {
    expect(useAuthStore.getState().isHydrating).toBe(true);
  });

  it("setIsHydrating updates the flag", () => {
    useAuthStore.getState().setIsHydrating(false);

    expect(useAuthStore.getState().isHydrating).toBe(false);
  });
});
