import { defineRouting } from "next-intl/routing";

// vi mặc định KHÔNG có prefix (vd "/login"), en có prefix "/en" (vd
// "/en/login") — localePrefix "as-needed" đúng nghĩa này: chỉ locale khác
// default mới bị thêm prefix vào URL.
export const routing = defineRouting({
  locales: ["vi", "en"],
  defaultLocale: "vi",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
