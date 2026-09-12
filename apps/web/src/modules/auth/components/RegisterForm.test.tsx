import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { withIntl } from "@/shared/lib/test-i18n";

import { RegisterForm } from "./RegisterForm";

describe("RegisterForm", () => {
  it("shows confirmPassword mismatch error and does not submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<RegisterForm onSubmit={onSubmit} />));

    await user.type(screen.getByLabelText("Họ tên"), "Nguyen Van A");
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Mật khẩu"), "password123");
    await user.type(screen.getByLabelText("Nhập lại mật khẩu"), "wrongpassword");
    await user.click(screen.getByRole("button", { name: "Đăng ký" }));

    expect(await screen.findByText("Mật khẩu nhập lại không khớp")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with validated values when confirmPassword matches", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<RegisterForm onSubmit={onSubmit} />));

    await user.type(screen.getByLabelText("Họ tên"), "Nguyen Van A");
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Mật khẩu"), "password123");
    await user.type(screen.getByLabelText("Nhập lại mật khẩu"), "password123");
    await user.click(screen.getByRole("button", { name: "Đăng ký" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        {
          name: "Nguyen Van A",
          email: "user@example.com",
          password: "password123",
          confirmPassword: "password123",
        },
        expect.anything(),
      ),
    );
  });

  it("disables submit button while isSubmitting", () => {
    render(withIntl(<RegisterForm onSubmit={vi.fn()} isSubmitting />));

    expect(screen.getByRole("button", { name: "Đang đăng ký..." })).toBeDisabled();
  });
});
