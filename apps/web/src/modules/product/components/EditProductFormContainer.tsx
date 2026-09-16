'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/shared/lib/api-client';
import { useCategories } from '../hooks/useCategories';
import { useProduct } from '../hooks/useProduct';
import { useUpdateProduct } from '../hooks/useUpdateProduct';
import { ProductForm, productToFormValues, type ProductFormSubmitValues } from './ProductForm';

interface EditProductFormContainerProps {
  productId: string;
}

// PATCH /products/:id không cần shopId trong URL (ShopOwnerGuard tự tra
// ngược từ productId ở BE) — khác CreateProductFormContainer, container này
// không cần biết "shop của tôi" nên không có vấn đề cross-module.
export function EditProductFormContainer({ productId }: EditProductFormContainerProps) {
  const t = useTranslations('product');
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
      setError(err instanceof ApiError ? err.message : t('productFormUpdateGenericError'));
    }
  }

  if (categoriesQuery.isPending || productQuery.isPending) {
    return <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>;
  }
  if (categoriesQuery.isError || productQuery.isError || !productQuery.data) {
    return <p className="text-sm text-destructive">{t('loadProductError')}</p>;
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
