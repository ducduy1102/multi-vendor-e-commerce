import { defineRouting } from 'next-intl/routing';

// vi mặc định KHÔNG có prefix (vd "/login"), en có prefix "/en" (vd
// "/en/login") — localePrefix "as-needed" đúng nghĩa này: chỉ locale khác
// default mới bị thêm prefix vào URL.
//
// `localeDetection: false` (Week10.md 2.3): locale CHỈ do URL quyết định — URL không prefix luôn là tiếng
// Việt. Mặc định next-intl đoán ngôn ngữ từ header `Accept-Language` của trình duyệt và từ cookie
// NEXT_LOCALE đã nhớ rồi 307 sang "/en", nên người có trình duyệt tiếng Anh vào "/" bị đẩy sang bản tiếng
// Anh dù sàn này mặc định là tiếng Việt. Muốn dùng tiếng Anh thì chọn tường minh bằng LocaleSwitcher (URL có
// "/en"), và F5/chia sẻ link vẫn giữ nguyên vì ngôn ngữ nằm trong URL.
export const routing = defineRouting({
  locales: ['vi', 'en'],
  defaultLocale: 'vi',
  localePrefix: 'as-needed',
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
