"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@/shared/lib/api-client";

import { register } from "../services/auth.service";
import type { RegisterFormInput } from "../types";
import { RegisterForm } from "./RegisterForm";

// Nối RegisterForm (UI + validate, Bước 3.3) với service gọi API (Bước 3.5)
// — đặt trong modules/ để app/register/page.tsx chỉ compose, không viết logic
// nghiệp vụ trực tiếp (rules/frontend.md mục 1). Đăng ký xong KHÔNG tự login
// (BE cũng không issue token ở /register) — điều hướng sang /login để người
// dùng tự đăng nhập.
export function RegisterFormContainer() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: RegisterFormInput) {
    setIsSubmitting(true);
    setError(null);
    try {
      // confirmPassword chỉ để validate ở FE (Bước 3.2) — không gửi lên BE.
      await register({
        email: values.email,
        password: values.password,
        name: values.name,
      });
      router.push("/login");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Đăng ký thất bại, vui lòng thử lại",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <RegisterForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
    </div>
  );
}
