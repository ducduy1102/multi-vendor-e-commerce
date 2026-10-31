import { getTranslations } from 'next-intl/server';

import { EditProductFormContainer } from '@/modules/product';

import { ProductAppealEntry } from '../../_components/ProductAppealEntry';

interface EditProductPageProps {
  params: Promise<{ id: string }>;
}

// Server Component (không cần ngoại lệ như trang new/list) — PATCH
// /products/:id không cần biết shopId, chỉ cần productId từ URL. Chỉ có MỘT chỗ
// ghép module: mục kháng nghị cho sản phẩm bị gỡ (Week11.md 5.8) cần "shop của tôi"
// nên đi qua ProductAppealEntry (composition root); slot là ReactNode tĩnh.
export default async function EditProductPage({ params }: EditProductPageProps) {
  const { id } = await params;
  const t = await getTranslations('product');

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-16">
      <h1 className="mb-6 text-xl font-semibold text-foreground">{t('editProductTitle')}</h1>
      <EditProductFormContainer productId={id} appealSlot={<ProductAppealEntry productId={id} />} />
    </div>
  );
}
