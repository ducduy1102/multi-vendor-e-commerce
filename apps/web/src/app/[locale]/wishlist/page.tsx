import { getTranslations } from 'next-intl/server';

import { WishlistPageContainer } from '@/modules/wishlist';
import { Container } from '@/shared/components/Container';

// Route đã chốt ở Week5.md Bước 1.13 (hướng a — route riêng, không gộp vào
// 1 trang "tài khoản" tổng). Bảo vệ đăng nhập ở proxy.ts
// (PROTECTED_PATH_PREFIXES, đúng 1.12 — wishlist chỉ cho user đã đăng
// nhập), không tự kiểm tra lại ở đây.
export default async function WishlistPage() {
  const t = await getTranslations('wishlist');

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-6 py-10">
          <h1 className="text-xl font-semibold text-foreground">{t('pageTitle')}</h1>
          <WishlistPageContainer />
        </Container>
      </main>
    </div>
  );
}
