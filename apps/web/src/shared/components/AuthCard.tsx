// Khối card dùng chung cho 4 trang xác thực/onboarding (/login, /register,
// /verify-email, /seller/onboarding) — trước đó mỗi trang tự lặp lại y hệt
// class Tailwind của card này. Thuần trình bày, không phụ thuộc module nào.
export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-sm">
      {children}
    </div>
  );
}
