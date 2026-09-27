// Dời từ modules/auth/auth.constants.ts (Week7.md 2.9) — module `order` cần dựng URL redirect
// return của cổng thanh toán về trang kết quả FE, đủ ngưỡng ≥ 2 module dùng (rules/general.md mục 1).
// auth.constants.ts import lại từ đây để giữ nguyên các nơi đang dùng trong module auth.
export function getFrontendUrl(): string {
  return process.env.FRONTEND_URL?.trim() || 'http://localhost:3000';
}
