import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { withIntl } from "@/shared/lib/test-i18n";

import { LoginForm } from "./LoginForm";

describe("LoginForm", () => {
  it("shows field errors and does not submit when form is empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<LoginForm onSubmit={onSubmit} />));

    await user.click(screen.getByRole("button", { name: "Đăng nhập" }));

    expect(await screen.findByText("Vui lòng nhập mật khẩu")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with validated values when form is filled correctly", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<LoginForm onSubmit={onSubmit} />));

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Mật khẩu"), "password123");
    await user.click(screen.getByRole("button", { name: "Đăng nhập" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        { email: "user@example.com", password: "password123" },
        expect.anything(),
      ),
    );
  });

  it("disables submit button while isSubmitting", () => {
    render(withIntl(<LoginForm onSubmit={vi.fn()} isSubmitting />));

    expect(screen.getByRole("button", { name: "Đang đăng nhập..." })).toBeDisabled();
  });
});
