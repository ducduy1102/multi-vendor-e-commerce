import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Button } from '@/shared/components/ui/button';

// Hero tĩnh tối giản cho trang chủ — <h1> + 1 câu mô tả + 1 nút tới
// /products. Không ảnh, không slider, không animation, không quản lý qua
// admin (đã chốt ở rules/frontend.md mục 13). Server Component (async, gọi
// getTranslations trực tiếp — không cần Client Component vì không có
// state/tương tác nào). Đặt ở shared/ vì không thuộc riêng module nào
// (giống Header) — app/[locale]/page.tsx chỉ compose lại.
export async function HomeHero() {
  const t = await getTranslations('home');

  return (
    <section className="flex flex-col gap-3 border-b border-border pb-8">
      <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">{t('heroTitle')}</h1>
      <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">{t('heroDescription')}</p>
      <div>
        <Button nativeButton={false} render={<Link href="/products" />}>
          {t('heroCta')}
        </Button>
      </div>
    </section>
  );
}
