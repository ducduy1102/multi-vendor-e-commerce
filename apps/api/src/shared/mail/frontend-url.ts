import { getFrontendUrl } from '../utils/frontend-url';
import { DEFAULT_MAIL_LOCALE, type MailLocale } from './mail-locale';

// URL tuyệt đối tới một trang của FE, đúng prefix ngôn ngữ của người nhận (Week9.md 1.12). FE dùng next-intl
// `localePrefix: 'as-needed'`: `vi` KHÔNG có prefix, `en` có `/en` — link thiếu prefix sẽ mở trang tiếng Việt
// dù email là tiếng Anh. `path` là đường dẫn nội bộ do server dựng (hằng số, id), có thể kèm query; mọi giá
// trị động đi vào query phải được người gọi `encodeURIComponent`.
export function frontendUrl(path: string, locale: MailLocale): string {
  const base = getFrontendUrl().replace(/\/+$/, '');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const prefix = locale === DEFAULT_MAIL_LOCALE ? '' : `/${locale}`;
  return `${base}${prefix}${normalized}`;
}
