import type { ReactElement } from 'react';
import { NextIntlClientProvider } from 'next-intl';

import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';

const MESSAGES = { vi: viMessages, en: enMessages };

// Bọc component cần test khi nó dùng Link/useRouter/useTranslations từ
// @/i18n/navigation hoặc next-intl — các API đó đọc locale + messages hiện
// tại qua context, không tự chạy được nếu render đơn lẻ ngoài
// NextIntlClientProvider. Dùng thẳng messages/vi.json thật (không phải object
// rỗng) để test xác nhận đúng bản dịch thật hiển thị ra, không chỉ "không
// crash" — thiếu bước này y hệt bug đã gặp: NextIntlClientProvider không có
// `messages` khiến next-intl render ra chuỗi key thô (vd "auth.loginSubmit")
// thay vì bản dịch. Mặc định `vi`; truyền `'en'` để kiểm bản tiếng Anh (vd chắc
// chắn không lộ chuỗi tiếng Việt do BE trả ở `/en`), cũng dùng messages/en.json thật.
export function withIntl(ui: ReactElement, locale: 'vi' | 'en' = 'vi') {
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {ui}
    </NextIntlClientProvider>
  );
}
