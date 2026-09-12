import type { routing } from "@/i18n/routing";
import type messages from "./messages/vi.json";

// Augment next-intl's AppConfig để useTranslations()/t() có autocomplete +
// type-check đúng key thật trong messages/vi.json — gõ sai tên key hoặc dùng
// namespace không tồn tại sẽ báo lỗi TypeScript ngay lúc code, không phải
// runtime mới phát hiện. Chọn vi.json làm "nguồn sự thật" cho type vì đây là
// locale mặc định (routing.ts) — en.json phải khớp đúng cấu trúc key.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
