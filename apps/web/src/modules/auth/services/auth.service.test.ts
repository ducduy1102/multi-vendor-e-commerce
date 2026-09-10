import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/lib/api-client";

import { login, logout, refresh, register } from "./auth.service";

const mockUser = {
  id: "user-1",
  email: "user@example.com",
  name: "Nguyen Van A",
  role: "USER",
};

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

describe("auth.service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("login returns the parsed user on success", async () => {
    mockFetchOnce({ success: true, data: { user: mockUser } });

    const result = await login({ email: "user@example.com", password: "password123" });

    expect(result).toEqual(mockUser);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/login"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("register returns the parsed user on success", async () => {
    mockFetchOnce({ success: true, data: { user: mockUser } }, 201);

    const result = await register({
      email: "user@example.com",
      password: "password123",
      name: "Nguyen Van A",
    });

    expect(result).toEqual(mockUser);
  });

  it("throws ApiError with the BE message when the request fails", async () => {
    mockFetchOnce(
      { success: false, data: null, message: "Email hoặc mật khẩu không đúng" },
      401,
    );

    await expect(
      login({ email: "user@example.com", password: "wrong" }),
    ).rejects.toMatchObject(new ApiError("Email hoặc mật khẩu không đúng", 401));
  });

  it("refresh and logout resolve without throwing on success", async () => {
    mockFetchOnce({ success: true, data: { message: "ok" } });
    await expect(refresh()).resolves.toBeUndefined();

    mockFetchOnce({ success: true, data: { message: "ok" } });
    await expect(logout()).resolves.toBeUndefined();
  });
});
