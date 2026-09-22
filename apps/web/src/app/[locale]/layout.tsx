import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Geist, Geist_Mono } from 'next/font/google';

import { routing } from '@/i18n/routing';
import { AuthHydrator, EmailVerificationBanner } from '@/modules/auth';
import { BottomTabBar, MobileTabBarSpacer } from '@/shared/components/BottomTabBar';
import { Header } from '@/shared/components/Header';
import { QueryProvider } from '@/shared/components/QueryProvider';
import { ThemeProvider } from '@/shared/components/ThemeProvider';

import '../globals.css';

// 'vietnamese' bat buoc co - subset 'latin' khong bao gom dau tieng Viet
// (a, e, o...), thieu se lam chu tieng Viet fallback sang font he thong
// (xem globals.css --font-sans, da fix loi tro vong chinh no o day).
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'vietnamese'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Next.js prerender sẵn 2 trang tĩnh (vi/en) cho mọi route khi có thể, thay
// vì render động mỗi request chỉ vì đọc `params.locale`.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

// title.template dùng thẳng "Chốt" (không qua i18n) — siteName giống hệt
// nhau ở cả 2 locale (xem messages/*.json "header.siteName"), chỉ
// description mới khác theo ngôn ngữ nên mới cần dịch. Promise.all để 2
// getTranslations() độc lập chạy song song, không await nối tiếp.
//
// generateMetadata() và LocaleLayout() là 2 hàm Next.js gọi riêng, cùng
// nhận `params` nhưng không chia sẻ state cho nhau — phải tự check
// hasLocale() lại ở đây (không dựa vào check đã làm trong LocaleLayout)
// để `locale` được TypeScript thu hẹp đúng type "vi" | "en" mà
// getTranslations() (bản có type an toàn theo message keys) đòi hỏi.
export async function generateMetadata({ params }: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const [tHeader, tMetadata] = await Promise.all([
    getTranslations({ locale, namespace: 'header' }),
    getTranslations({ locale, namespace: 'metadata' }),
  ]);
  const siteName = tHeader('siteName');

  return {
    title: {
      default: siteName,
      template: `%s | ${siteName}`,
    },
    description: tMetadata('description'),
  };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Cho phép các Server Component con dùng getTranslations()/setRequestLocale
  // đọc đúng locale hiện tại thay vì phải truyền tay qua props.
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          <ThemeProvider>
            <QueryProvider>
              <AuthHydrator />
              <Header />
              <EmailVerificationBanner />
              <MobileTabBarSpacer>{children}</MobileTabBarSpacer>
              <BottomTabBar />
            </QueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
