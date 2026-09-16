'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Controller,
  useFieldArray,
  useForm,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import type { Category, Product } from '../types';
import { buildVariantMatrix } from './ProductForm.utils';
import { VariantImageUpload } from './VariantImageUpload';

// Schema RIÊNG cho form (khác createProductSchema/updateProductSchema ở
// @ecommerce/types) — chỉ validate UX tức thời ở FE, BE (ZodValidationPipe +
// createProductSchema/updateProductSchema) vẫn là nơi validate thật cuối
// cùng, không cần lặp lại 100% cùng rule (vd "giá trị variant phải thuộc
// attribute đã khai" không cần check ở đây vì attributeValues luôn được TỰ
// SINH từ chính attributes theo cấu trúc, không phải do người dùng gõ tay).
//
// 2 điểm khác biệt CÓ CHỦ ĐÍCH so với schema dùng chung ở @ecommerce/types:
// 1. attributes[].values là { value: string }[] (không phải string[]) —
//    react-hook-form useFieldArray bắt buộc mảng phần tử là object.
// 2. price/stock giữ dạng string (không z.coerce.number()) — dùng
//    z.coerce/`.transform()` khiến input/output type của schema lệch nhau,
//    zodResolver + useForm không tự khớp được 2 type đó cho 1 schema có
//    field lồng sâu (mảng-trong-mảng) như ở đây, TypeScript báo lỗi kiểu
//    "Two different types with this name exist, but they are unrelated" dù
//    logic runtime đúng. Convert sang number bằng tay ở toSubmitPayload()
//    ngay trước khi gọi onSubmit, tránh toàn bộ vấn đề generic này.
const productFormValueSchema = z.object({
  value: z.string().trim().min(1, 'Giá trị không được để trống'),
});

const productFormAttributeSchema = z
  .object({
    name: z.string().trim().min(1, 'Tên thuộc tính không được để trống'),
    values: z.array(productFormValueSchema).min(1, 'Cần ít nhất 1 giá trị'),
  })
  // Giá trị trùng (không phân biệt hoa/thường, vd "M" và "m") trong CÙNG 1
  // thuộc tính là lỗi cần chặn ngay tại tầng 1 (FE), không đợi tới khi BE
  // trả lỗi — tránh tích Descartes sinh ra 2 tổ hợp trùng tên khiến seller
  // không phân biệt được dòng nào là dòng nào. Báo lỗi tại đúng ô giá trị bị
  // lặp (không phải ô đầu tiên) để seller biết chính xác cần sửa dòng nào.
  .superRefine((attribute, ctx) => {
    const seen = new Map<string, number>();
    attribute.values.forEach((item, valueIndex) => {
      const key = item.value.trim().toLowerCase();
      if (key === '') {
        return;
      }
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Giá trị "${item.value}" đã tồn tại trong thuộc tính này (không phân biệt hoa/thường)`,
          path: ['values', valueIndex, 'value'],
        });
      } else {
        seen.set(key, valueIndex);
      }
    });
  });

const productFormVariantSchema = z.object({
  sku: z.string().trim().min(1, 'SKU không được để trống'),
  price: z
    .string()
    .trim()
    .refine((v) => Number(v) > 0, 'Giá phải lớn hơn 0'),
  stock: z
    .string()
    .trim()
    .refine((v) => Number.isInteger(Number(v)) && Number(v) >= 0, 'Tồn kho phải là số nguyên >= 0'),
  attributeValues: z.array(z.string()),
  // Gán qua VariantImageUpload (Controller, Bước 3.8) — không có <input
  // type="text"> nào register trực tiếp field này.
  imageUrl: z.string().optional(),
});

const productFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Tên sản phẩm không được để trống'),
    categoryId: z.string().trim().min(1, 'Vui lòng chọn danh mục'),
    description: z.string().trim().optional(),
    // Cả 3 status (không chỉ DRAFT/PUBLISHED) — "Sửa" ở trang quản lý Seller
    // (Bước 3.6) không chặn sửa product đã ARCHIVED, nếu chỉ cho chọn 2 giá
    // trị thì lưu form sẽ vô tình unarchive (đổi ARCHIVED -> DRAFT) sản
    // phẩm đó dù người dùng không cố ý.
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
    // Không dùng .default([]) — z.array().default() làm input/output type
    // của field này lệch nhau (optional ở input, bắt buộc ở output), khiến
    // zodResolver + useForm không tự khớp được type cho 1 field lồng sâu
    // như attributes (cùng loại vấn đề đã ghi ở comment đầu file cho price/
    // stock). EMPTY_DEFAULT_VALUES bên dưới đã tự cung cấp `attributes: []`
    // qua defaultValues của react-hook-form, không cần default() ở schema.
    attributes: z.array(productFormAttributeSchema),
    variants: z.array(productFormVariantSchema).min(1, 'Cần ít nhất 1 biến thể'),
  })
  .superRefine((data, ctx) => {
    const skuSet = new Set<string>();
    data.variants.forEach((variant, index) => {
      if (skuSet.has(variant.sku)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `SKU "${variant.sku}" bị lặp lại`,
          path: ['variants', index, 'sku'],
        });
      }
      skuSet.add(variant.sku);
    });
  });

export type ProductFormValues = z.infer<typeof productFormSchema>;

// Shape thật gửi lên Container (khớp CreateProductInput/UpdateProductInput
// ở @ecommerce/types, chỉ khác price/stock đã convert sang number).
export interface ProductFormSubmitValues {
  name: string;
  categoryId: string;
  description?: string;
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  attributes: { name: string; values: string[] }[];
  variants: {
    sku: string;
    price: number;
    stock: number;
    attributeValues: string[];
    imageUrl?: string;
  }[];
}

function toSubmitPayload(values: ProductFormValues): ProductFormSubmitValues {
  return {
    name: values.name,
    categoryId: values.categoryId,
    description: values.description ? values.description : undefined,
    status: values.status,
    attributes: values.attributes.map((attribute) => ({
      name: attribute.name,
      values: attribute.values.map((v) => v.value),
    })),
    variants: values.variants.map((variant) => ({
      sku: variant.sku,
      price: Number(variant.price),
      stock: Number(variant.stock),
      attributeValues: variant.attributeValues,
      imageUrl: variant.imageUrl,
    })),
  };
}

const EMPTY_DEFAULT_VALUES: ProductFormValues = {
  name: '',
  categoryId: '',
  description: '',
  attributes: [],
  variants: [{ sku: '', price: '', stock: '', attributeValues: [], imageUrl: undefined }],
};

// Chuyển response Product (GET /products/:id) thành defaultValues cho form
// sửa — chỉ lấy variant ACTIVE (variant bị soft-delete không hiện lại trong
// form, đúng cách updateProduct reconcile ở BE: chỉ variant có trong payload
// mới được giữ/tạo, còn lại tự bị set isActive=false). attributeValues của
// mỗi variant ở response là cặp {attributeName, value} không theo thứ tự cố
// định — đổi lại thành mảng THEO VỊ TRÍ khớp đúng thứ tự `attributes` (bất
// biến bắt buộc của createProductSchema/updateProductSchema).
export function productToFormValues(product: Product): ProductFormValues {
  return {
    name: product.name,
    categoryId: product.categoryId,
    description: product.description ?? '',
    status: product.status,
    attributes: product.attributes.map((attribute) => ({
      name: attribute.name,
      values: attribute.values.map((v) => ({ value: v.value })),
    })),
    variants: product.variants
      .filter((variant) => variant.isActive)
      .map((variant) => ({
        sku: variant.sku,
        price: variant.price,
        stock: String(variant.stock),
        attributeValues: product.attributes.map(
          (attribute) =>
            variant.attributeValues.find((av) => av.attributeName === attribute.name)?.value ?? '',
        ),
        imageUrl: variant.imageUrl ?? undefined,
      })),
  };
}

// Chung 1 template cột cho header lẫn từng dòng variant — tránh header và
// dòng dữ liệu lệch cột nếu sửa 1 nơi quên sửa nơi kia. Cột cuối (ảnh) rộng
// hơn vì chứa cả thumbnail + nút bấm.
const VARIANT_GRID_COLS = 'md:grid-cols-[minmax(140px,1fr)_1fr_1fr_1fr_160px]';

interface ProductFormProps {
  categories: Category[];
  mode: 'create' | 'edit';
  defaultValues?: ProductFormValues;
  onSubmit: (values: ProductFormSubmitValues) => void | Promise<void>;
  isSubmitting?: boolean;
  submitError?: string | null;
}

// Component phức tạp nhất Tuần 4 (Week4.md Bước 3.7) — field cơ bản + UI
// khai attribute (useFieldArray lồng, mỗi attribute có 1 mảng giá trị riêng)
// + tự sinh bảng ma trận variant (buildVariantMatrix, ProductForm.utils.ts)
// khi attribute/giá trị đổi. Cùng 1 component cho cả tạo (mode="create") và
// sửa (mode="edit", thêm field status) — không tách 2 component như
// BecomeSellerForm/UpdateShopForm vì phần attribute+variant matrix giống
// nhau hoàn toàn giữa 2 mode, tách riêng sẽ trùng lặp phần khó nhất.
export function ProductForm({
  categories,
  mode,
  defaultValues,
  onSubmit,
  isSubmitting,
  submitError,
}: ProductFormProps) {
  const t = useTranslations('product');
  const {
    control,
    register,
    handleSubmit,
    getValues,
    watch,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: defaultValues ?? EMPTY_DEFAULT_VALUES,
    // Validate ngay khi rời khỏi field (blur), không chỉ lúc bấm submit —
    // seller thấy lỗi giá trị trùng/SKU trùng ngay lúc đang khai, không phải
    // đợi điền hết cả form rồi mới bị báo hàng loạt.
    mode: 'onBlur',
  });

  const attributesFieldArray = useFieldArray({ control, name: 'attributes' });
  const variantsFieldArray = useFieldArray({ control, name: 'variants' });
  const watchedAttributes = watch('attributes');

  // Tính lại bảng ma trận variant từ attributes hiện tại (đọc trực tiếp qua
  // getValues, không qua watch, để không tính lại thừa mỗi lần render) — gọi
  // ngay sau mọi thao tác đổi tên thuộc tính/thêm-xoá thuộc tính hoặc
  // giá trị. buildVariantMatrix tự tái sử dụng sku/price/stock của variant
  // cũ theo tổ hợp giá trị, không xoá sạch dữ liệu người dùng đã nhập.
  function regenerateVariants() {
    const attributes = getValues('attributes');
    const currentVariants = getValues('variants');
    const nextVariants = buildVariantMatrix(attributes, currentVariants);
    variantsFieldArray.replace(nextVariants);
  }

  function handleAddAttribute() {
    attributesFieldArray.append({ name: '', values: [{ value: '' }] });
  }

  function handleRemoveAttribute(index: number) {
    attributesFieldArray.remove(index);
    regenerateVariants();
  }

  function handleFormSubmit(values: ProductFormValues) {
    return onSubmit(toSubmitPayload(values));
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} noValidate className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-name">{t('productFormNameLabel')}</Label>
          <Input id="product-name" type="text" aria-invalid={!!errors.name} {...register('name')} />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-category">{t('productFormCategoryLabel')}</Label>
          <select
            id="product-category"
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            aria-invalid={!!errors.categoryId}
            {...register('categoryId')}
          >
            <option value="">{t('productFormCategoryPlaceholder')}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.parentId ? `— ${category.name}` : category.name}
              </option>
            ))}
          </select>
          {errors.categoryId && (
            <p className="text-sm text-destructive">{errors.categoryId.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-description">{t('productFormDescriptionLabel')}</Label>
          <Textarea id="product-description" {...register('description')} />
        </div>

        {mode === 'edit' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-status">{t('productFormStatusLabel')}</Label>
            <select
              id="product-status"
              className="h-8 w-full max-w-xs rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              {...register('status')}
            >
              <option value="DRAFT">{t('statusDraft')}</option>
              <option value="PUBLISHED">{t('statusPublished')}</option>
              <option value="ARCHIVED">{t('statusArchived')}</option>
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t('productFormAttributesTitle')}
          </h2>
          <Button type="button" variant="outline" size="sm" onClick={handleAddAttribute}>
            {t('productFormAddAttribute')}
          </Button>
        </div>

        {attributesFieldArray.fields.map((attributeField, attributeIndex) => (
          <AttributeRow
            key={attributeField.id}
            control={control}
            register={register}
            attributeIndex={attributeIndex}
            onRemoveAttribute={() => handleRemoveAttribute(attributeIndex)}
            onValuesChanged={regenerateVariants}
            removeAttributeLabel={t('productFormRemoveAttribute')}
            addValueLabel={t('productFormAddValue')}
            removeValueLabel={t('productFormRemoveValue')}
            valuePlaceholder={t('productFormValuePlaceholder')}
            namePlaceholder={t('productFormAttributeNamePlaceholder')}
            attributeErrors={errors.attributes?.[attributeIndex]}
          />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">{t('productFormVariantsTitle')}</h2>
        {errors.variants?.root?.message && (
          <p className="text-sm text-destructive">{errors.variants.root.message}</p>
        )}

        <div
          className={`hidden gap-4 px-3 text-xs font-medium text-muted-foreground ${VARIANT_GRID_COLS} md:grid`}
        >
          <span>{t('productFormComboHeader')}</span>
          <span>{t('productFormSkuLabel')}</span>
          <span>{t('productFormPriceLabel')}</span>
          <span>{t('productFormStockLabel')}</span>
          <span>{t('productFormImageLabel')}</span>
        </div>

        <div className="flex flex-col gap-3">
          {variantsFieldArray.fields.map((variantField, variantIndex) => {
            const comboLabel =
              variantField.attributeValues.length === 0
                ? t('productFormVariantDefaultLabel')
                : (watchedAttributes ?? [])
                    .map(
                      (attribute, i) =>
                        `${attribute.name}: ${variantField.attributeValues[i] ?? ''}`,
                    )
                    .join(', ');
            const variantErrors = errors.variants?.[variantIndex];
            const hasRowError = !!(
              variantErrors?.sku ||
              variantErrors?.price ||
              variantErrors?.stock
            );

            return (
              <div
                key={variantField.id}
                className={`grid grid-cols-1 gap-3 rounded-lg border p-3 ${VARIANT_GRID_COLS} md:items-start md:gap-4 ${
                  hasRowError ? 'border-destructive bg-destructive/5' : 'border-border'
                }`}
              >
                <p className="text-sm text-muted-foreground md:pt-1.5">{comboLabel}</p>

                <div className="flex flex-col gap-1">
                  <Label htmlFor={`variant-sku-${variantIndex}`} className="md:sr-only">
                    {t('productFormSkuLabel')}
                  </Label>
                  <Input
                    id={`variant-sku-${variantIndex}`}
                    type="text"
                    aria-invalid={!!variantErrors?.sku}
                    {...register(`variants.${variantIndex}.sku`)}
                  />
                  {errors.variants?.[variantIndex]?.sku && (
                    <p className="text-sm text-destructive">
                      {errors.variants[variantIndex]?.sku?.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor={`variant-price-${variantIndex}`} className="md:sr-only">
                    {t('productFormPriceLabel')}
                  </Label>
                  <Input
                    id={`variant-price-${variantIndex}`}
                    type="number"
                    aria-invalid={!!errors.variants?.[variantIndex]?.price}
                    {...register(`variants.${variantIndex}.price`)}
                  />
                  {errors.variants?.[variantIndex]?.price && (
                    <p className="text-sm text-destructive">
                      {errors.variants[variantIndex]?.price?.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor={`variant-stock-${variantIndex}`} className="md:sr-only">
                    {t('productFormStockLabel')}
                  </Label>
                  <Input
                    id={`variant-stock-${variantIndex}`}
                    type="number"
                    placeholder="0"
                    aria-invalid={!!errors.variants?.[variantIndex]?.stock}
                    {...register(`variants.${variantIndex}.stock`)}
                  />
                  {errors.variants?.[variantIndex]?.stock && (
                    <p className="text-sm text-destructive">
                      {errors.variants[variantIndex]?.stock?.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <Label className="md:sr-only">{t('productFormImageLabel')}</Label>
                  <Controller
                    control={control}
                    name={`variants.${variantIndex}.imageUrl`}
                    render={({ field }) => (
                      <VariantImageUpload
                        value={field.value}
                        onChange={field.onChange}
                        uploadLabel={t('productFormImageUpload')}
                        changeLabel={t('productFormImageChange')}
                        uploadingLabel={t('productFormImageUploading')}
                        removeLabel={t('productFormImageRemove')}
                        errorLabel={t('productFormImageError')}
                      />
                    )}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}

      <Button type="submit" disabled={isSubmitting} className="self-start">
        {mode === 'create'
          ? isSubmitting
            ? t('productFormSubmitCreating')
            : t('productFormSubmitCreate')
          : isSubmitting
            ? t('productFormSubmitUpdating')
            : t('productFormSubmitUpdate')}
      </Button>
    </form>
  );
}

interface AttributeRowProps {
  control: Control<ProductFormValues>;
  register: UseFormRegister<ProductFormValues>;
  attributeIndex: number;
  onRemoveAttribute: () => void;
  onValuesChanged: () => void;
  removeAttributeLabel: string;
  addValueLabel: string;
  removeValueLabel: string;
  namePlaceholder: string;
  valuePlaceholder: string;
  attributeErrors?: NonNullable<FieldErrors<ProductFormValues>['attributes']>[number];
}

// Tách riêng để gọi useFieldArray lồng (attributes.${index}.values) — mỗi
// attribute có 1 mảng giá trị động riêng của nó.
function AttributeRow({
  control,
  register,
  attributeIndex,
  onRemoveAttribute,
  onValuesChanged,
  removeAttributeLabel,
  addValueLabel,
  removeValueLabel,
  namePlaceholder,
  valuePlaceholder,
  attributeErrors,
}: AttributeRowProps) {
  const valuesFieldArray = useFieldArray({
    control,
    name: `attributes.${attributeIndex}.values`,
  });
  const nameRegister = register(`attributes.${attributeIndex}.name`);
  const nameError = attributeErrors?.name?.message;
  // Lỗi cấp mảng (vd "Cần ít nhất 1 giá trị") khác `.root` với react-hook-
  // form khi field là mảng object có superRefine riêng — cả 2 dạng đều có
  // thể xuất hiện tuỳ tình huống nên đọc cả `.message` lẫn `.root?.message`.
  const valuesArrayError =
    attributeErrors?.values?.message ??
    (attributeErrors?.values as { root?: { message?: string } } | undefined)?.root?.message;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <Input
          type="text"
          placeholder={namePlaceholder}
          aria-invalid={!!nameError}
          className="max-w-xs"
          {...nameRegister}
          onBlur={(e) => {
            void nameRegister.onBlur(e);
            onValuesChanged();
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={removeAttributeLabel}
          className="ml-auto"
          onClick={onRemoveAttribute}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {nameError && <p className="text-sm text-destructive">{nameError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {valuesFieldArray.fields.map((valueField, valueIndex) => {
          const valueRegister = register(`attributes.${attributeIndex}.values.${valueIndex}.value`);
          const valueError = attributeErrors?.values?.[valueIndex]?.value?.message;
          return (
            <div key={valueField.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <Input
                  type="text"
                  placeholder={valuePlaceholder}
                  className="w-32"
                  aria-invalid={!!valueError}
                  {...valueRegister}
                  onBlur={(e) => {
                    void valueRegister.onBlur(e);
                    onValuesChanged();
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={removeValueLabel}
                  onClick={() => {
                    valuesFieldArray.remove(valueIndex);
                    onValuesChanged();
                  }}
                >
                  ×
                </Button>
              </div>
              {valueError && <p className="text-xs text-destructive">{valueError}</p>}
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => valuesFieldArray.append({ value: '' })}
        >
          {addValueLabel}
        </Button>
      </div>
      {valuesArrayError && <p className="text-sm text-destructive">{valuesArrayError}</p>}
    </div>
  );
}
