import type { UserLocale } from '@prisma/client';

// Ngôn ngữ của MỘT email = `User.locale` (Week9.md 1.12). Cố ý trỏ thẳng vào enum Prisma thay vì khai lại
// 'vi' | 'en': thêm một giá trị vào `UserLocale` làm MỌI từ điển `Record<MailLocale, Copy>` của template
// thành lỗi biên dịch cho tới khi có bản dịch — không có đường nào để một email lặng lẽ rơi về tiếng Việt.
export type MailLocale = UserLocale;

// Khớp `defaultLocale` của next-intl ở FE (`localePrefix: 'as-needed'`: ngôn ngữ mặc định không có prefix).
export const DEFAULT_MAIL_LOCALE: MailLocale = 'vi';
