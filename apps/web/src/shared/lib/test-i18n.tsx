import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";

// Bọc component cần test khi nó dùng Link/useRouter từ @/i18n/navigation —
// các API đó đọc locale hiện tại qua context, không tự chạy được nếu render
// đơn lẻ ngoài NextIntlClientProvider (khác next/link gốc, không cần context
// gì). Không cần truyền `messages` — chỉ component nào gọi useTranslations()
// mới cần, các component auth hiện tại chưa dùng i18n message thật (Bước 4.4).
export function withIntl(ui: ReactElement) {
  return <NextIntlClientProvider locale="vi">{ui}</NextIntlClientProvider>;
}
