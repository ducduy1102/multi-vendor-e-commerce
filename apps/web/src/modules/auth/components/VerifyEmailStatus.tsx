"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { ApiError } from "@/shared/lib/api-client";

import { verifyEmail } from "../services/auth.service";
import { useAuthStore } from "../store/auth.store";
import { ResendVerificationButton } from "./ResendVerificationButton";

type VerifyState =
  | { status: "loading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

interface VerifyEmailStatusProps {
  token: string | null;
}

export function VerifyEmailStatus({ token }: VerifyEmailStatusProps) {
  const [state, setState] = useState<VerifyState>({ status: "loading" });
  const user = useAuthStore((s) => s.user);
  // Token verify chỉ dùng được 1 lần — React StrictMode (dev) chạy effect 2
  // lần, nếu gọi verifyEmail() 2 lần thì lần 2 sẽ luôn báo lỗi "không hợp lệ"
  // dù lần 1 đã thành công. Ref này chặn gọi lại cho cùng 1 token.
  const requestedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token || requestedTokenRef.current === token) {
      return;
    }
    requestedTokenRef.current = token;

    verifyEmail(token)
      .then((result) => setState({ status: "success", message: result.message }))
      .catch((err) =>
        setState({
          status: "error",
          message: err instanceof ApiError ? err.message : "Xác thực email thất bại, vui lòng thử lại",
        }),
      );
  }, [token]);

  if (!token) {
    return <p className="text-sm text-destructive">Thiếu token xác thực trong đường dẫn</p>;
  }

  if (state.status === "loading") {
    return <p className="text-sm text-muted-foreground">Đang xác thực email...</p>;
  }

  if (state.status === "success") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm">{state.message}</p>
        <Button nativeButton={false} render={<Link href={user ? "/" : "/login"} />}>
          {user ? "Về trang chủ" : "Đăng nhập"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-sm text-destructive">{state.message}</p>
      {user ? (
        <ResendVerificationButton />
      ) : (
        <Button variant="outline" nativeButton={false} render={<Link href="/login" />}>
          Đăng nhập để gửi lại email xác thực
        </Button>
      )}
    </div>
  );
}
