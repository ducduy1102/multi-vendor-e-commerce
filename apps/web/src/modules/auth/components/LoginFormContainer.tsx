"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@/shared/lib/api-client";

import { login } from "../services/auth.service";
import { useAuthStore } from "../store/auth.store";
import type { LoginInput } from "../types";
import { GoogleLoginButton } from "./GoogleLoginButton";
import { LoginForm } from "./LoginForm";

interface LoginFormContainerProps {
  // Lỗi đọc từ query param ?error= sau khi Google OAuth callback thất bại
  // (xem AuthController.googleCallback) — app/login/page.tsx (Server
  // Component) đọc searchParams rồi truyền message đã dịch sẵn xuống đây.
  initialError?: string;
}

// Nối LoginForm (UI + validate, Bước 3.3) với service gọi API (Bước 3.5) +
// store (Bước 3.4) — đặt trong modules/ để app/login/page.tsx chỉ compose,
// không viết logic nghiệp vụ trực tiếp (rules/frontend.md mục 1).
export function LoginFormContainer({ initialError }: LoginFormContainerProps) {
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

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
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        hoặc
        <div className="h-px flex-1 bg-border" />
      </div>
      <GoogleLoginButton />
    </div>
  );
}
