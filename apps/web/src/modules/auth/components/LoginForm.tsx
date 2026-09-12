"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

import { loginSchema } from "../schemas/auth.schema";
import type { LoginInput } from "../types";

interface LoginFormProps {
  onSubmit: (values: LoginInput) => void | Promise<void>;
  isSubmitting?: boolean;
}

// Chỉ lo UI + validate — gọi API (Bước 3.5) và lưu user vào store (Bước 3.4)
// do component cha truyền onSubmit vào, form không tự biết về service/store.
export function LoginForm({ onSubmit, isSubmitting }: LoginFormProps) {
  const t = useTranslations("auth");
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-email">{t("loginEmailLabel")}</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          aria-invalid={!!errors.email}
          {...register("email")}
        />
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-password">{t("loginPasswordLabel")}</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          {...register("password")}
        />
        {errors.password && (
          <p className="text-sm text-destructive">{errors.password.message}</p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting} className="mt-2">
        {isSubmitting ? t("loginSubmitting") : t("loginSubmit")}
      </Button>
    </form>
  );
}
