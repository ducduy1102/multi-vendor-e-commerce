import { getTranslations } from 'next-intl/server';

import { AccountNav } from '@/modules/account';
import { Container } from '@/shared/components/Container';

// Khung chung của khu /account/* (hồ sơ, sổ địa chỉ, mật khẩu): tiêu đề + thanh điều hướng con, mỗi
// trang con chỉ ghép phần nội dung của nó. Bảo vệ đăng nhập ở proxy.ts (PROTECTED_PATH_PREFIXES), không tự
// kiểm tra lại ở đây — như /orders, /wishlist.
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('account');

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-6 py-10">
          <h1 className="text-xl font-semibold text-foreground">{t('pageTitle')}</h1>
          <AccountNav />
          {children}
        </Container>
      </main>
    </div>
  );
}
