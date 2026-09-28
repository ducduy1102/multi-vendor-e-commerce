import { getTranslations } from 'next-intl/server';

import { CartPageContainer } from '@/modules/cart';
import { Container } from '@/shared/components/Container';

// Không thêm /cart vào PROTECTED_PATH_PREFIXES ở proxy.ts (Week6.md 1.16) —
// guest cũng xem/sửa giỏ được (giỏ lưu localStorage, tính qua POST
// /cart/quote), khác /wishlist bắt buộc đăng nhập.
export default async function CartPage() {
  const t = await getTranslations('cart');

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-6 py-10">
          <h1 className="text-xl font-semibold text-foreground">{t('pageTitle')}</h1>
          <CartPageContainer />
        </Container>
      </main>
    </div>
  );
}
