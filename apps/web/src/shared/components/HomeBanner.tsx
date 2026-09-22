import { PackageSearch, Store } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { ChotMark } from '@/shared/components/ChotMark';
import { SellerChannelLink } from '@/shared/components/SellerChannelLink';
import { Button } from '@/shared/components/ui/button';

// Class dùng chung cho 2 banner nhỏ (Link tĩnh + SellerChannelLink client) —
// 1 nguồn duy nhất, tránh lệch style giữa 2 thẻ.
const SMALL_BANNER_CLASS =
  'flex flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-4 outline-none transition-colors hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

// Thay HomeHero (rules/frontend.md mục 13 "UI polish đợt 2" mục 5) — cụm
// banner dựng thuần CSS/SVG, không ảnh ngoài, không carousel, không thêm
// dependency. Server Component (async, gọi getTranslations trực tiếp) —
// chỉ banner nhỏ 1 ("Bán hàng cùng Chốt") cần href động theo trạng thái
// đăng nhập/shop, tách riêng ra SellerChannelLink (Client Component nhỏ
// nhất có thể, xem file đó) thay vì kéo cả HomeBanner thành "use client".
// Đặt NGOÀI <Suspense> ở page.tsx — hiện ngay, không chờ HomeCatalog fetch.
export async function HomeBanner() {
  const t = await getTranslations('home');

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {/* Banner lớn — chiếm 2/3 chiều rộng từ md trở lên, full width ở mobile. */}
      <div className="relative flex flex-col justify-center gap-4 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary),white_12%),var(--primary))] p-6 text-primary-foreground sm:p-8 md:col-span-2">
        {/* Hình trang trí — ChotMark phóng lớn, độ mờ thấp, thuần trang trí. */}
        <ChotMark className="pointer-events-none absolute -right-10 -bottom-10 size-56 opacity-15" />

        <h1 className="relative max-w-sm text-2xl font-semibold sm:text-3xl">
          {t('bannerHeading')}
        </h1>
        <div className="relative">
          <Button variant="secondary" nativeButton={false} render={<Link href="/products" />}>
            {t('bannerCta')}
          </Button>
        </div>
      </div>

      {/* 2 banner nhỏ — xếp dọc bên phải từ md trở lên, 2 cột bên dưới ở mobile. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-1">
        <SellerChannelLink className={SMALL_BANNER_CLASS}>
          <Store className="size-5 text-primary" />
          <span className="text-sm font-medium text-foreground">{t('bannerSellerTitle')}</span>
        </SellerChannelLink>

        <Link href="/products" className={SMALL_BANNER_CLASS}>
          <PackageSearch className="size-5 text-primary" />
          <span className="text-sm font-medium text-foreground">{t('bannerNewProductsTitle')}</span>
        </Link>
      </div>
    </section>
  );
}
