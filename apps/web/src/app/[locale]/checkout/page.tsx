import { getTranslations } from 'next-intl/server';

import { CheckoutContainer } from '@/modules/checkout';
import { Container } from '@/shared/components/Container';

interface CheckoutPageProps {
  searchParams: Promise<{ voucher?: string }>;
}

// Route đã nằm trong PROTECTED_PATH_PREFIXES ở proxy.ts (Week7.md 3.2) — guest bị đẩy sang
// /login?next=/checkout trước khi tới được đây, không tự kiểm tra lại ở page này (cùng pattern
// /wishlist).
export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  // 2 await độc lập — Promise.all thay vì nối tiếp (vercel-react-best-practices, async-parallel).
  const [{ voucher }, t] = await Promise.all([searchParams, getTranslations('checkout')]);

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-6 py-10">
          <h1 className="text-xl font-semibold text-foreground">{t('pageTitle')}</h1>
          <CheckoutContainer initialVoucherCode={voucher} />
        </Container>
      </main>
    </div>
  );
}
