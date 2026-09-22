"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Link, useRouter } from "@/i18n/navigation";
import { FieldSeparator } from "@/shared/components/ui/field";
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
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
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
      setError(err instanceof ApiError ? err.message : t("loginGenericError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <LoginForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
      <FieldSeparator>{tCommon("or")}</FieldSeparator>
      <GoogleLoginButton />
      <p className="text-center text-sm text-muted-foreground">
        {t("loginNoAccountPrompt")}{" "}
        <Link
          href="/register"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("loginRegisterLink")}
        </Link>
      </p>
    </div>
  );
}
