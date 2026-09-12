import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../messages/vi.json";

// Bọc component cần test khi nó dùng Link/useRouter/useTranslations từ
// @/i18n/navigation hoặc next-intl — các API đó đọc locale + messages hiện
// tại qua context, không tự chạy được nếu render đơn lẻ ngoài
// NextIntlClientProvider. Dùng thẳng messages/vi.json thật (không phải object
// rỗng) để test xác nhận đúng bản dịch thật hiển thị ra, không chỉ "không
// crash" — thiếu bước này y hệt bug đã gặp: NextIntlClientProvider không có
// `messages` khiến next-intl render ra chuỗi key thô (vd "auth.loginSubmit")
// thay vì bản dịch.
export function withIntl(ui: ReactElement) {
  return (
    <NextIntlClientProvider locale="vi" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}
