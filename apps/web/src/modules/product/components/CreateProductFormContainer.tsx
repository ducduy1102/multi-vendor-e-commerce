'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/shared/lib/api-client';
import { useApiErrorMessage } from '@/shared/hooks/useValidationMessage';
import { useCategories } from '../hooks/useCategories';
import { useCreateProduct } from '../hooks/useCreateProduct';
import { ProductForm, type ProductFormSubmitValues } from './ProductForm';
import { ProductFormSkeleton } from './ProductFormSkeleton';

interface CreateProductFormContainerProps {
  shopId: string;
}

// shopId nhận qua prop (đã resolve sẵn ở app/seller/products/new/page.tsx —
// cùng lý do modules/product không tự gọi useMyShop(), xem
// SellerProductsContainer/Week4.md Bước 3.6).
export function CreateProductFormContainer({ shopId }: CreateProductFormContainerProps) {
  const t = useTranslations('product');
  const tApi = useApiErrorMessage();
  const tCommon = useTranslations('common');
  const router = useRouter();
  const categoriesQuery = useCategories();
  const createProduct = useCreateProduct();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: ProductFormSubmitValues) {
    setError(null);
    try {
      await createProduct.mutateAsync({
        shopId,
        values: {
          name: values.name,
          categoryId: values.categoryId,
          description: values.description,
          attributes: values.attributes,
          variants: values.variants,
        },
      });
      router.push('/seller/products');
    } catch (err) {
      setError(err instanceof ApiError ? tApi(err.message) : t('productFormCreateGenericError'));
    }
  }

  if (categoriesQuery.isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{tCommon('loading')}</span>
        <ProductFormSkeleton />
      </div>
    );
  }
  if (categoriesQuery.isError) {
    return <p className="text-sm text-destructive">{t('loadProductError')}</p>;
  }

  return (
    <ProductForm
      mode="create"
      categories={categoriesQuery.data}
      onSubmit={handleSubmit}
      isSubmitting={createProduct.isPending}
      submitError={error}
    />
  );
}
