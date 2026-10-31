'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { useCategories } from '../hooks/useCategories';
import { useDescribeProductError } from '../hooks/useDescribeProductError';
import { useProduct } from '../hooks/useProduct';
import { useUpdateProduct } from '../hooks/useUpdateProduct';
import { ProductForm, productToFormValues, type ProductFormSubmitValues } from './ProductForm';
import { ProductFormSkeleton } from './ProductFormSkeleton';
import { ProductTakenDownNotice } from './ProductTakenDownNotice';

interface EditProductFormContainerProps {
  productId: string;
}

// PATCH /products/:id không cần shopId trong URL (ShopOwnerGuard tự tra
// ngược từ productId ở BE) — khác CreateProductFormContainer, container này
// không cần biết "shop của tôi" nên không có vấn đề cross-module.
export function EditProductFormContainer({ productId }: EditProductFormContainerProps) {
  const t = useTranslations('product');
  const describeError = useDescribeProductError();
  const tCommon = useTranslations('common');
  const router = useRouter();
  const categoriesQuery = useCategories();
  const productQuery = useProduct(productId);
  const updateProduct = useUpdateProduct();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: ProductFormSubmitValues) {
    setError(null);
    try {
      await updateProduct.mutateAsync({ id: productId, values });
      router.push('/seller/products');
    } catch (err) {
      setError(describeError(err, t('productFormUpdateGenericError')));
    }
  }

  if (categoriesQuery.isPending || productQuery.isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{tCommon('loading')}</span>
        <ProductFormSkeleton />
      </div>
    );
  }
  if (categoriesQuery.isError || productQuery.isError || !productQuery.data) {
    return <p className="text-sm text-destructive">{t('loadProductError')}</p>;
  }

  // Sàn đã gỡ sản phẩm (Week11.md 5.7): chủ shop không sửa/xuất bản/lưu trữ được nên không dựng form, chỉ hiện lý do.
  if (productQuery.data.status === 'TAKEN_DOWN') {
    return (
      <ProductTakenDownNotice
        productName={productQuery.data.name}
        reason={productQuery.data.takenDownReason}
      />
    );
  }

  return (
    <ProductForm
      mode="edit"
      categories={categoriesQuery.data}
      defaultValues={productToFormValues(productQuery.data)}
      onSubmit={handleSubmit}
      isSubmitting={updateProduct.isPending}
      submitError={error}
    />
  );
}
