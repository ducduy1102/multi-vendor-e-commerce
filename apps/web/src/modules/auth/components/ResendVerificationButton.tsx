"use client";

import { useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { ApiError } from "@/shared/lib/api-client";

import { resendVerification } from "../services/auth.service";

interface ResendVerificationButtonProps {
  size?: "default" | "sm";
}

// Dùng lại được ở nhiều chỗ (banner toàn app, trang /verify-email khi hết
// hạn/không hợp lệ) — chỉ hoạt động khi đã đăng nhập (BE yêu cầu JwtAuthGuard),
// nơi gọi tự quyết định có hiện component này hay không dựa vào useAuthStore.
export function ResendVerificationButton({ size = "default" }: ResendVerificationButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleClick() {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const result = await resendVerification();
      setFeedback(result.message);
    } catch (err) {
      setFeedback(
        err instanceof ApiError ? err.message : "Gửi lại email xác thực thất bại, vui lòng thử lại",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size={size} onClick={handleClick} disabled={isSubmitting}>
        {isSubmitting ? "Đang gửi..." : "Gửi lại email xác thực"}
      </Button>
      {feedback && <p className="text-sm">{feedback}</p>}
    </div>
  );
}
