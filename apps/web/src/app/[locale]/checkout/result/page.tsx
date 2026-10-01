import { getTranslations } from 'next-intl/server';
import { z } from 'zod';

import { CheckoutResultContainer } from '@/modules/checkout';
import { Container } from '@/shared/components/Container';

// Return URL của cổng thanh toán (order.controller.ts: redirectToResultSuccess/Error) chỉ gắn 1
// trong 2: `?groupId=<uuid>` (thành công tới bước xác nhận chữ ký) hoặc `?error=invalid` (chữ ký
// sai/confirmPayment lỗi) — không có tham số nào khác của cổng bị chuyển tiếp (Week7.md 1.10, chống
// XSS phản chiếu). Container không tự đọc lại `error` hay bất kỳ query nào khác: thiếu/sai `groupId`
// (bao gồm cả trường hợp `error=invalid`) đều rơi về đúng 1 nhánh "liên kết không hợp lệ".
interface CheckoutResultPageProps {
  searchParams: Promise<{ groupId?: string }>;
}

const groupIdSchema = z.string().uuid();

// Route nằm trong PROTECTED_PATH_PREFIXES qua tiền tố "/checkout" (proxy.ts, Week7.md 3.2) — guest
// bị đẩy sang /login?next=... trước khi tới được đây, không tự kiểm tra lại ở page này.
export default async function CheckoutResultPage({ searchParams }: CheckoutResultPageProps) {
  const [{ groupId }, t] = await Promise.all([searchParams, getTranslations('checkout')]);
  const parsedGroupId = groupIdSchema.safeParse(groupId);

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-6 py-10">
          <h1 className="text-xl font-semibold text-foreground">{t('resultPageTitle')}</h1>
          <CheckoutResultContainer groupId={parsedGroupId.success ? parsedGroupId.data : null} />
        </Container>
      </main>
    </div>
  );
}
