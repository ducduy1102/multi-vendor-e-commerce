'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';

interface ErrorPageProps {
  // Shape chuẩn Next.js App Router truyền cho error.tsx (digest: mã lỗi
  // server tự gắn khi throw ở Server Component, dùng để tra log phía
  // server — không phải thứ hiển thị cho người dùng).
  error: Error & { digest?: string };
  reset: () => void;
}

// Error boundary chung cho MỌI route trong app/[locale]/ (trang chủ,
// /products...) — Client Component bắt buộc theo quy ước file error.tsx
// của Next.js App Router. Layout ([locale]/layout.tsx) vẫn render bình
// thường phía trên boundary này (Header vẫn dùng được), chỉ phần nội dung
// route lỗi (page.tsx chưa kịp trả JSX) được thay bằng UI này.
//
// KHÔNG hiện error.message/stack cho người dùng (rules/frontend.md mục UI
// polish 4) — chỉ log ra console để debug, UI chỉ hiện thông báo chung đã
// dịch sẵn + nút thử lại (gọi reset() Next.js cấp sẵn, tự re-render lại
// route thay vì reload cả trang).
export default function ErrorBoundary({ error, reset }: ErrorPageProps) {
  const t = useTranslations('error');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <h1 className="text-xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <Button type="button" onClick={() => reset()}>
          {t('retry')}
        </Button>
      </div>
    </div>
  );
}
