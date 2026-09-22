import { getTranslations } from 'next-intl/server';

import { EditProductFormContainer } from '@/modules/product';

interface EditProductPageProps {
  params: Promise<{ id: string }>;
}

// Server Component thuần (không cần ngoại lệ như trang new/list) — PATCH
// /products/:id không cần biết shopId, chỉ cần productId từ URL, không phải
// ghép nối module product/shop nào cả.
export default async function EditProductPage({ params }: EditProductPageProps) {
  const { id } = await params;
  const t = await getTranslations('product');

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-16">
      <h1 className="mb-6 text-xl font-semibold text-foreground">{t('editProductTitle')}</h1>
      <EditProductFormContainer productId={id} />
    </div>
  );
}
