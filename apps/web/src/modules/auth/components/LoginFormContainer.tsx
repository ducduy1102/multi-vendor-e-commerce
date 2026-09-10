"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@/shared/lib/api-client";

import { login } from "../services/auth.service";
import { useAuthStore } from "../store/auth.store";
import type { LoginInput } from "../types";
import { LoginForm } from "./LoginForm";

// Nối LoginForm (UI + validate, Bước 3.3) với service gọi API (Bước 3.5) +
// store (Bước 3.4) — đặt trong modules/ để app/login/page.tsx chỉ compose,
// không viết logic nghiệp vụ trực tiếp (rules/frontend.md mục 1).
export function LoginFormContainer() {
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: LoginInput) {
    setIsSubmitting(true);
    setError(null);
    try {
      const user = await login(values);
      setUser(user);
      router.push("/");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Đăng nhập thất bại, vui lòng thử lại",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <LoginForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
    </div>
  );
}
