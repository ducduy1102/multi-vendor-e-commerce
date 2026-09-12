import { Button } from "@/shared/components/ui/button";
import { API_BASE_URL } from "@/shared/lib/api-client";

// Điều hướng cả trang (thẻ <a>, KHÔNG phải fetch) — OAuth là flow redirect
// dựa trên trình duyệt, không gọi được qua JS/fetch bình thường. BE
// (GET /auth/google) tự redirect sang Google, rồi Google redirect lại
// BE (/auth/google/callback) set cookie xong redirect thẳng về FE.
export function GoogleLoginButton() {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      nativeButton={false}
      render={<a href={`${API_BASE_URL}/auth/google`} />}
    >
      Đăng nhập với Google
    </Button>
  );
}
