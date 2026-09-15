import { z, type RefinementCtx } from 'zod';

export const productStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export type ProductStatus = z.infer<typeof productStatusSchema>;

// Input HTML bỏ trống gửi lên chuỗi rỗng "" (React Hook Form), không phải
// undefined — coi "" như chưa nhập, cùng lý do đã áp dụng ở shop.ts.
const optionalTrimmedString = () =>
  z
    .string()
    .trim()
    .optional()
    .transform((val) => (val === '' ? undefined : val));

const optionalUrlSchema = (message: string) =>
  z
    .string()
    .trim()
    .optional()
    .refine((val) => !val || z.string().url().safeParse(val).success, {
      message,
    })
    .transform((val) => (val === '' ? undefined : val));

const productAttributeInputSchema = z.object({
  name: z.string().trim().min(1, 'Tên thuộc tính không được để trống'),
  values: z
    .array(
      z.string().trim().min(1, 'Giá trị thuộc tính không được để trống'),
    )
    .min(1, 'Thuộc tính cần ít nhất 1 giá trị'),
});

// attributeValues[i] tương ứng THEO VỊ TRÍ với attributes[i] cùng cấp (không
// tra theo tên) — attributeValues[i] phải là 1 giá trị nằm trong
// attributes[i].values. Service dùng đúng cặp (attribute, value theo vị trí)
// này để build map "value string -> ProductAttributeValue.id" trong
// transaction tạo/sửa Product.
const productVariantInputSchema = z.object({
  sku: z.string().trim().min(1, 'SKU không được để trống'),
  price: z.number().positive('Giá phải lớn hơn 0'),
  stock: z.number().int().nonnegative('Tồn kho không được âm'),
  attributeValues: z.array(z.string().trim().min(1)).default([]),
  imageUrl: optionalUrlSchema('URL ảnh không hợp lệ'),
});

function validateAttributesAndVariants(
  attributes: { name: string; values: string[] }[],
  variants: { sku: string; attributeValues: string[] }[],
  ctx: RefinementCtx,
) {
  const attributeNames = new Set<string>();
  attributes.forEach((attribute, index) => {
    if (attributeNames.has(attribute.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tên thuộc tính "${attribute.name}" bị lặp lại`,
        path: ['attributes', index, 'name'],
      });
    }
    attributeNames.add(attribute.name);

    if (new Set(attribute.values).size !== attribute.values.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Thuộc tính "${attribute.name}" có giá trị bị lặp lại`,
        path: ['attributes', index, 'values'],
      });
    }
  });

  const skuSet = new Set<string>();
  const comboSet = new Set<string>();
  variants.forEach((variant, index) => {
    if (skuSet.has(variant.sku)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `SKU "${variant.sku}" bị lặp lại trong cùng request`,
        path: ['variants', index, 'sku'],
      });
    }
    skuSet.add(variant.sku);

    if (variant.attributeValues.length !== attributes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Số giá trị thuộc tính của biến thể không khớp số thuộc tính đã khai',
        path: ['variants', index, 'attributeValues'],
      });
      return;
    }

    variant.attributeValues.forEach((value, valueIndex) => {
      const attribute = attributes[valueIndex];
      if (attribute && !attribute.values.includes(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Giá trị "${value}" không thuộc thuộc tính "${attribute.name}"`,
          path: ['variants', index, 'attributeValues', valueIndex],
        });
      }
    });

    const combo = variant.attributeValues.join('|');
    if (comboSet.has(combo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Có 2 biến thể trùng tổ hợp thuộc tính',
        path: ['variants', index, 'attributeValues'],
      });
    }
    comboSet.add(combo);
  });
}

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1, 'Tên sản phẩm không được để trống'),
    categoryId: z.string().trim().min(1, 'Vui lòng chọn danh mục'),
    description: optionalTrimmedString(),
    attributes: z.array(productAttributeInputSchema).default([]),
    variants: z
      .array(productVariantInputSchema)
      .min(1, 'Cần ít nhất 1 biến thể'),
  })
  .superRefine((data, ctx) =>
    validateAttributesAndVariants(data.attributes, data.variants, ctx),
  );
export type CreateProductInput = z.infer<typeof createProductSchema>;

// Không cho sửa status qua đây (archive có action riêng, xem
// ProductService.archiveProduct). attributes/variants: bỏ trống cả 2 = giữ
// nguyên, gửi cả 2 = thay thế toàn bộ theo logic reconciliation trong
// ProductService.updateProduct (khớp theo sku: có sẵn -> update, mới -> tạo,
// mất trong payload -> isActive = false, không xoá cứng) — chỉ gửi 1 trong 2
// là lỗi.
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1, 'Tên sản phẩm không được để trống').optional(),
    categoryId: z.string().trim().min(1, 'Vui lòng chọn danh mục').optional(),
    description: optionalTrimmedString(),
    attributes: z.array(productAttributeInputSchema).optional(),
    variants: z
      .array(productVariantInputSchema)
      .min(1, 'Cần ít nhất 1 biến thể')
      .optional(),
  })
  .superRefine((data, ctx) => {
    const hasAttributes = data.attributes !== undefined;
    const hasVariants = data.variants !== undefined;
    if (hasAttributes !== hasVariants) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'attributes và variants phải cùng được gửi hoặc cùng bỏ trống',
        path: hasAttributes ? ['variants'] : ['attributes'],
      });
      return;
    }
    if (!data.attributes || !data.variants) {
      return;
    }
    validateAttributesAndVariants(data.attributes, data.variants, ctx);
  });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// Response đầy đủ 1 Product (kèm nested attributes/variants) — FE dùng để
// parse() response từ BE và pre-fill lại form sửa.
export const productAttributeValueSchema = z.object({
  id: z.string(),
  value: z.string(),
});
export type ProductAttributeValueDto = z.infer<
  typeof productAttributeValueSchema
>;

export const productAttributeSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number(),
  values: z.array(productAttributeValueSchema),
});
export type ProductAttributeDto = z.infer<typeof productAttributeSchema>;

// Không trả nguyên bảng nối VariantAttributeValue/ProductAttributeValue cho
// FE — chỉ trả cặp tên thuộc tính + giá trị đã resolve sẵn, dễ hiển thị
// ("Màu sắc: Đỏ") mà không cần FE tự join lại.
export const productVariantAttributeValueSchema = z.object({
  attributeName: z.string(),
  value: z.string(),
});

export const productVariantSchema = z.object({
  id: z.string(),
  sku: z.string(),
  // Prisma Decimal serialize qua JSON thành string (decimal.js toJSON()) —
  // FE tự Number() khi cần tính toán, không parse thành number ở schema này
  // để không mất độ chính xác thập phân.
  price: z.string(),
  stock: z.number(),
  isActive: z.boolean(),
  imageUrl: z.string().nullable(),
  weightGram: z.number().nullable(),
  attributeValues: z.array(productVariantAttributeValueSchema),
});
export type ProductVariantDto = z.infer<typeof productVariantSchema>;

export const productSchema = z.object({
  id: z.string(),
  shopId: z.string(),
  categoryId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: productStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  attributes: z.array(productAttributeSchema),
  variants: z.array(productVariantSchema),
});
export type Product = z.infer<typeof productSchema>;
