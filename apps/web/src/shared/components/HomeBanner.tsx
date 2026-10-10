import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { ChotMark } from '@/shared/components/ChotMark';
import { Button } from '@/shared/components/ui/button';

// Thay HomeHero (rules/frontend.md mục 13 "UI polish đợt 2" mục 5) — banner
// dựng thuần CSS/SVG, không ảnh ngoài, không carousel, không thêm
// dependency. Server Component (async, gọi getTranslations trực tiếp) —
// không còn phần nào cần client state nữa (2 banner phụ "Bán hàng cùng
// Chốt"/"Sản phẩm mới" đã bỏ ở "UI polish đợt 2 lần 2" mục 2 vì trùng đích
// với 2 mục nav ở Header, chưa có nội dung nào khác biệt để lấp vào; sẽ thêm
// lại banner phụ khi có nội dung thật sự khác nav, vd khuyến mãi/danh mục
// nổi bật theo mùa). Đặt NGOÀI <Suspense> ở page.tsx — hiện ngay, không
// chờ HomeCatalog fetch.
export async function HomeBanner() {
  const t = await getTranslations('home');

  return (
    // --brand-fixed (không phải --primary/--brand) cố ý — 2 token kia tự đổi
    // sáng hơn ở dark mode để đủ tương phản cho nút bấm nhỏ, nhưng áp lên cả
    // 1 khối nền lớn thế này sẽ biến banner thành khối rất sáng giữa 1 trang
    // tối, lệch tông với toàn bộ UI còn lại. --brand-fixed giữ đúng màu
    // thương hiệu #0F766E bất kể theme; --brand-fixed-foreground đi cùng
    // cũng cố định trắng, không dùng --primary-foreground (sẽ ra chữ tối
    // trên nền tối ở dark mode).
    <section className="relative flex flex-col justify-center gap-4 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,color-mix(in_oklch,var(--brand-fixed),white_12%),var(--brand-fixed))] p-6 text-brand-fixed-foreground sm:p-8">
      {/* Hình trang trí — ChotMark phóng lớn, độ mờ thấp, thuần trang trí. */}
      <ChotMark className="pointer-events-none absolute -right-10 -bottom-10 size-56 opacity-15" />

      <h1 className="relative max-w-sm text-2xl font-semibold sm:text-3xl">{t('bannerHeading')}</h1>
      <div className="relative">
        <Button variant="secondary" nativeButton={false} render={<Link href="/products" />}>
          {t('bannerCta')}
        </Button>
      </div>
    </section>
  );
}
