import { z, type RefinementCtx } from 'zod';
import { validationMessage } from './validation-message';

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

// `id` optional — có nghĩa "đây là giá trị/thuộc tính ĐÃ TỒN TẠI, update tại
// chỗ theo id này" (giống Shopify productOptionUpdate) khi gửi trong
// updateProductSchema. Không có `id` (hoặc `id` không resolve được ở
// ProductService.reconcileAttributesAndVariants) -> LUÔN tạo mới, KHÔNG
// fallback về match theo text — match theo text (name/value) là nguyên nhân
// bug orphan row khi seller đổi tên (mỗi lần đổi tên bị hiểu nhầm thành xoá +
// tạo mới, để lại row rác vĩnh viễn vì attribute/value không hard-delete).
// `id` bị bỏ qua khi dùng ở createProductSchema (tạo mới hoàn toàn, không có
// gì để match).
const productAttributeValueInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  value: z.string().trim().min(1, 'product.validationValueRequired'),
});

const productAttributeInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1, 'product.validationAttributeNameRequired'),
  values: z.array(productAttributeValueInputSchema).min(1, 'product.validationAttributeValuesMin'),
});

// attributeValues[i] tương ứng THEO VỊ TRÍ với attributes[i] cùng cấp (không
// tra theo tên) — attributeValues[i] phải là 1 giá trị nằm trong
// attributes[i].values. Service dùng đúng cặp (attribute, value theo vị trí)
// này để build map "value string -> ProductAttributeValue.id" trong
// transaction tạo/sửa Product.
// Week5.md Bước 1.3/2.12 — nhiều ảnh/variant (thay cho `imageUrl` đơn cũ).
// Request chỉ cần mảng URL (đã ký sẵn qua signed upload) — `position` suy
// từ thứ tự trong mảng, không cần gửi tường minh.
const productVariantInputSchema = z.object({
  sku: z.string().trim().min(1, 'product.validationSkuRequired'),
  price: z.number().positive('product.validationPricePositive'),
  stock: z.number().int().nonnegative('product.validationStockInvalid'),
  attributeValues: z.array(z.string().trim().min(1)).default([]),
  images: z.array(z.string().trim().url('product.validationImageUrlInvalid')).default([]),
});

function validateAttributesAndVariants(
  attributes: { name: string; values: { id?: string; value: string }[] }[],
  variants: { sku: string; attributeValues: string[] }[],
  ctx: RefinementCtx,
) {
  const attributeNames = new Set<string>();
  attributes.forEach((attribute, index) => {
    if (attributeNames.has(attribute.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: validationMessage('product.validationAttributeNameDuplicate', {
          name: attribute.name,
        }),
        path: ['attributes', index, 'name'],
      });
    }
    attributeNames.add(attribute.name);

    // So sánh không phân biệt hoa/thường ("M" và "m" cùng bị coi là trùng) —
    // khớp với check FE ở ProductForm.tsx (cùng bất biến, 2 nơi validate
    // cùng 1 rule không được lệch nhau). Path trỏ vào `.value` (không phải
    // cả phần tử values[valueIndex]) vì values giờ là object {id?, value},
    // khớp đúng path FE dùng ở productFormAttributeSchema's superRefine.
    const seenValues = new Map<string, number>();
    attribute.values.forEach((value, valueIndex) => {
      const key = value.value.trim().toLowerCase();
      if (seenValues.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: validationMessage('product.validationValueDuplicate', {
            value: value.value,
            attribute: attribute.name,
          }),
          path: ['attributes', index, 'values', valueIndex, 'value'],
        });
      } else {
        seenValues.set(key, valueIndex);
      }
    });
  });

  const skuSet = new Set<string>();
  const comboSet = new Set<string>();
  variants.forEach((variant, index) => {
    if (skuSet.has(variant.sku)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: validationMessage('product.validationSkuDuplicate', {
          sku: variant.sku,
        }),
        path: ['variants', index, 'sku'],
      });
    }
    skuSet.add(variant.sku);

    if (variant.attributeValues.length !== attributes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'product.validationVariantValueCountMismatch',
        path: ['variants', index, 'attributeValues'],
      });
      return;
    }

    variant.attributeValues.forEach((value, valueIndex) => {
      const attribute = attributes[valueIndex];
      if (attribute && !attribute.values.some((v) => v.value === value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: validationMessage('product.validationVariantValueNotInAttribute', {
            value,
            attribute: attribute.name,
          }),
          path: ['variants', index, 'attributeValues', valueIndex],
        });
      }
    });

    const combo = variant.attributeValues.join('|');
    if (comboSet.has(combo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'product.validationVariantComboDuplicate',
        path: ['variants', index, 'attributeValues'],
      });
    }
    comboSet.add(combo);
  });
}

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1, 'product.validationNameRequired'),
    categoryId: z.string().trim().min(1, 'product.validationCategoryRequired'),
    description: optionalTrimmedString(),
    attributes: z.array(productAttributeInputSchema).default([]),
    variants: z.array(productVariantInputSchema).min(1, 'product.validationVariantsMin'),
  })
  .superRefine((data, ctx) => validateAttributesAndVariants(data.attributes, data.variants, ctx));
export type CreateProductInput = z.infer<typeof createProductSchema>;

// status cho sửa qua đây (DRAFT -> PUBLISHED "đăng bán", hoặc ngược lại) —
// archiveProduct chỉ là 1 action tiện lợi gọi cùng cơ chế này với
// status="ARCHIVED", không phải cơ chế riêng biệt duy nhất đổi được status.
// attributes/variants: bỏ trống cả 2 = giữ nguyên, gửi cả 2 = reconcile toàn
// bộ trong ProductService.updateProduct (khớp theo sku: có sẵn -> update,
// mới -> tạo, mất trong payload -> isActive = false, không xoá cứng; xem
// updateProduct-reconcile-decision.md cho attributes/values) — chỉ gửi 1
// trong 2 là lỗi.
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1, 'product.validationNameRequired').optional(),
    categoryId: z.string().trim().min(1, 'product.validationCategoryRequired').optional(),
    description: optionalTrimmedString(),
    status: productStatusSchema.optional(),
    attributes: z.array(productAttributeInputSchema).optional(),
    variants: z.array(productVariantInputSchema).min(1, 'product.validationVariantsMin').optional(),
  })
  .superRefine((data, ctx) => {
    const hasAttributes = data.attributes !== undefined;
    const hasVariants = data.variants !== undefined;
    if (hasAttributes !== hasVariants) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'product.validationAttributesVariantsTogether',
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
export type ProductAttributeValueDto = z.infer<typeof productAttributeValueSchema>;

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

// Week5.md Bước 1.3/2.12 — sắp sẵn theo position (BE trả đã sort), FE không
// cần tự sort lại.
export const productImageSchema = z.object({
  url: z.string(),
  position: z.number(),
});
export type ProductImageDto = z.infer<typeof productImageSchema>;

export const productVariantSchema = z.object({
  id: z.string(),
  sku: z.string(),
  // Prisma Decimal serialize qua JSON thành string (decimal.js toJSON()) —
  // FE tự Number() khi cần tính toán, không parse thành number ở schema này
  // để không mất độ chính xác thập phân.
  price: z.string(),
  // stock = số buyer đặt được (kho vật lý - đang giữ chỗ). reservedStock chỉ có khi viewer là
  // chủ shop (kho vật lý = stock + reservedStock) — Week7.md 1.3.
  stock: z.number(),
  reservedStock: z.number().int().nonnegative().optional(),
  isActive: z.boolean(),
  images: z.array(productImageSchema),
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
  // Denormalized từ variants active (Decimal -> string qua JSON, giống
  // variant.price) — FE hiển thị "từ {minPrice}đ" khi có nhiều variant giá
  // khác nhau, không tự tính lại từ variants[].
  minPrice: z.string(),
  maxPrice: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  attributes: z.array(productAttributeSchema),
  variants: z.array(productVariantSchema),
});
export type Product = z.infer<typeof productSchema>;

// Chỉ GET /products/:slug (chi tiết — ProductService.getProduct) trả thêm
// `shop` — create/update/archive dùng chung productSchema ở trên, không join
// bảng shops nên không có field này (Week5.md Bước 1.5/2.2-2.3, khớp
// ProductDetailSummary ở apps/api). Tách schema riêng thay vì thêm `shop`
// optional vào productSchema dùng chung, tránh mọi chỗ khác phải tự lường
// field này có mặt hay không.
export const productDetailSchema = productSchema.extend({
  shop: z.object({ name: z.string(), slug: z.string() }),
});
export type ProductDetail = z.infer<typeof productDetailSchema>;

// Response gọn cho danh sách Product của seller (GET /shops/:shopId/products,
// ProductService.getMyProducts) — không cần attributeValues/attributeName đã
// resolve (chỉ cần cho form sửa, xem productSchema), tránh join dư thừa cho
// 1 danh sách (rules/backend.md mục 4 — đặc biệt nhấn mạnh cho list product).
export const productListItemVariantSchema = z.object({
  id: z.string(),
  sku: z.string(),
  price: z.string(),
  // stock = số buyer đặt được (kho vật lý - đang giữ chỗ). reservedStock chỉ có khi viewer là
  // chủ shop (kho vật lý = stock + reservedStock) — Week7.md 1.3.
  stock: z.number(),
  reservedStock: z.number().int().nonnegative().optional(),
  isActive: z.boolean(),
  images: z.array(productImageSchema),
});

export const productListItemSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  name: z.string(),
  slug: z.string(),
  status: productStatusSchema,
  minPrice: z.string(),
  maxPrice: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  variants: z.array(productListItemVariantSchema),
});
export type ProductListItem = z.infer<typeof productListItemSchema>;

// Query cho GET /products (trang chủ + trang danh sách public, dùng chung —
// đúng quyết định Week4.md Bước 1.12, không tách endpoint /products/featured
// riêng). Query param qua URL luôn là string — coerce number cho page/limit/
// giá, tự chuẩn hoá attributeValues (1 giá trị -> string, ≥2 -> string[])
// thành mảng để FE lẫn BE dùng cùng 1 shape.
export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(12),
  sort: z.enum(['newest', 'price-asc', 'price-desc']).default('newest'),
  shopId: z.string().trim().optional(),
  categoryId: z.string().trim().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  // Lọc theo giá trị thuộc tính (màu/size...) — không tra theo tên attribute
  // cụ thể (đúng tinh thần "attribute không cố định cứng theo 1 ngành
  // hàng", note-db.md mục 2): product khớp nếu CÓ variant active mang giá
  // trị đó, mỗi giá trị trong mảng lọc độc lập (AND giữa các giá trị, không
  // cần cùng 1 variant) — giống hành vi facet filter thực tế (Shopee/Lazada).
  attributeValues: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => (val === undefined ? undefined : Array.isArray(val) ? val : [val])),
  // Search full-text (Week5.md Bước 1.6/1.8-1.9) — mở rộng GET /products có
  // sẵn thay vì tách endpoint riêng, kết hợp AND với các filter khác ở trên.
  q: z.string().trim().optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

// Card cho trang chủ/danh sách public — không trả description/attributes/
// toàn bộ variant (rules/backend.md mục 4), chỉ đủ hiển thị 1 ô sản phẩm.
// `imageUrl` (số ít, khác `productVariantSchema.images[]`) là 1 ảnh đại diện
// đã flatten sẵn ở BE (ảnh đầu tiên, position=0, của variant active đầu
// tiên) — card chỉ cần 1 ảnh bìa, không cần cả bộ ảnh/variant.
export const productCardSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  name: z.string(),
  slug: z.string(),
  minPrice: z.string(),
  maxPrice: z.string(),
  imageUrl: z.string().nullable(),
});
export type ProductCard = z.infer<typeof productCardSchema>;

export const productListResponseSchema = z.object({
  items: z.array(productCardSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type ProductListResponse = z.infer<typeof productListResponseSchema>;

// Response của POST /uploads/signature (CloudinaryService.generateUploadSignature,
// apps/api/src/shared/cloudinary/cloudinary.service.ts) — BE hiện định nghĩa
// riêng 1 interface TS thuần cùng shape (không qua Zod, vì đây là response cố
// định BE tự tạo ra, không phải input cần validate ở BE). Khai lại ở đây để
// FE có 1 schema Zod duy nhất validate response này trước khi dùng (đúng
// rules/general.md mục 4), không tự bịa lại field ở phía FE.
export const uploadSignatureSchema = z.object({
  signature: z.string(),
  timestamp: z.number(),
  apiKey: z.string(),
  cloudName: z.string(),
});
export type UploadSignature = z.infer<typeof uploadSignatureSchema>;
