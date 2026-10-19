import { z, type RefinementCtx } from 'zod';
import { SHOP_SLUG_MAX_LENGTH } from './shop';
import { validationMessage } from './validation-message';

// --- Ảnh sản phẩm: upload thẳng lên Cloudinary (Week10.md 2.4) ----------------------------------------------
// Mọi hằng số ở đây dùng chung cho BE (ký) và FE (nén + gửi) — định nghĩa MỘT lần để hai phía không lệch nhau.

// Thư mục đích trên Cloudinary. Là param ĐÃ KÝ: BE ký và FE gửi đúng chuỗi này, sai một ký tự là Cloudinary từ
// chối vì chữ ký không khớp (response ký không trả kèm param đã ký nên không lấy động được — rules/backend.md
// mục 6, "upload ảnh").
export const CLOUDINARY_UPLOAD_FOLDER = 'multi-vendor-ecommerce';

// Cạnh dài tối đa (px) của ảnh lưu trên Cloudinary. FE thu nhỏ ảnh về cỡ này TRƯỚC khi tải lên; BE ký thêm một
// incoming transformation cùng cỡ để dù client bỏ qua bước nén vẫn không lưu được ảnh lớn hơn.
export const PRODUCT_IMAGE_MAX_EDGE = 1600;

// Incoming transformation chạy NGAY khi Cloudinary nhận ảnh, trước khi lưu: `c_limit` chỉ thu nhỏ (không bao
// giờ phóng to, giữ tỉ lệ) vào khung MAX_EDGE × MAX_EDGE; `q_auto`/`f_auto` để Cloudinary chọn chất lượng và
// định dạng nhỏ nhất. Là param ĐÃ KÝ — cùng ràng buộc "khớp từng ký tự" như thư mục ở trên.
export const CLOUDINARY_INCOMING_TRANSFORMATION = `c_limit,w_${PRODUCT_IMAGE_MAX_EDGE},h_${PRODUCT_IMAGE_MAX_EDGE},q_auto,f_auto`;

// Giới hạn ảnh người bán được chọn: định dạng, dung lượng file GỐC (trước khi nén), và số ảnh mỗi biến thể.
export const PRODUCT_IMAGE_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PRODUCT_IMAGE_MAX_SOURCE_BYTES = 10 * 1024 * 1024;

// Số ảnh tối đa MỖI BIẾN THỂ. Các sàn đặt trần ở mức 8–9 ảnh cho mỗi sản phẩm (Shopee 9; Jumia, Falabella 8;
// eBay 12 ảnh cho mỗi biến thể) — ở đây ảnh gắn ở cấp biến thể nên 9 đã rộng hơn mặt bằng chung. Được ép ở
// ProductService (không ở schema Zod): luật là "không được THÊM ảnh vượt trần", sản phẩm cũ đang vượt trần vẫn
// sửa/lưu được bình thường miễn không tăng thêm — Zod không biết trạng thái cũ nên không diễn tả được luật đó.
export const PRODUCT_VARIANT_MAX_IMAGES = 9;

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
  // Trần PRODUCT_VARIANT_MAX_IMAGES KHÔNG ép ở đây mà ở ProductService (xem chú thích ở hằng số): schema này
  // dùng chung cho cả tạo lẫn sửa nhưng chỉ ProductService biết số ảnh hiện có để cho sản phẩm cũ đã vượt trần
  // vẫn lưu được.
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

// Điểm đánh giá denormalized (cột Product.avgRating/reviewCount, Week9.md 1.8): 0/0 khi chưa có đánh giá
// nào, FE chỉ hiện sao khi reviewCount > 0. Chỉ trả ở response PUBLIC (card + chi tiết); các response của
// seller (create/update/archive, danh sách shop) không cần.
const ratingShape = {
  avgRating: z.number().min(0).max(5),
  reviewCount: z.number().int().nonnegative(),
};

// Chỉ GET /products/:slug (chi tiết — ProductService.getProduct) trả thêm
// `shop` — create/update/archive dùng chung productSchema ở trên, không join
// bảng shops nên không có field này (Week5.md Bước 1.5/2.2-2.3, khớp
// ProductDetailSummary ở apps/api). Tách schema riêng thay vì thêm `shop`
// optional vào productSchema dùng chung, tránh mọi chỗ khác phải tự lường
// field này có mặt hay không.
export const productDetailSchema = productSchema.extend({
  shop: z.object({ name: z.string(), slug: z.string() }),
  ...ratingShape,
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

// Trần cho các tham số mà BE nhân thành việc tốn công ở DB (Week9.md 5.2): `page` đẩy OFFSET, mỗi giá trị
// `attributeValues` thành một điều kiện `some` lồng nhau (AND), `q` đi vào tsquery. URL dài ~8KB đủ chứa hàng
// trăm `attributeValues=` lặp nên không chặn thì một request rẻ có thể thành truy vấn rất nặng. Con số rộng
// hơn nhiều so với UI thật (bộ lọc chỉ có vài giá trị).
export const PRODUCT_LIST_MAX_PAGE = 10_000;
export const PRODUCT_SEARCH_MAX_LENGTH = 100;
export const PRODUCT_ATTRIBUTE_FILTER_MAX_VALUES = 20;
export const PRODUCT_ATTRIBUTE_FILTER_VALUE_MAX_LENGTH = 100;

// Query cho GET /products (trang chủ + trang danh sách public, dùng chung —
// đúng quyết định Week4.md Bước 1.12, không tách endpoint /products/featured
// riêng). Query param qua URL luôn là string — coerce number cho page/limit/
// giá, tự chuẩn hoá attributeValues (1 giá trị -> string, ≥2 -> string[])
// thành mảng để FE lẫn BE dùng cùng 1 shape.
export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(PRODUCT_LIST_MAX_PAGE).default(1),
  limit: z.coerce.number().int().positive().max(50).default(12),
  sort: z.enum(['newest', 'price-asc', 'price-desc', 'rating']).default('newest'),
  shopId: z.string().trim().optional(),
  // Lọc theo slug shop để trang shop công khai lấy shop và sản phẩm SONG SONG (không phải slug → id → sản
  // phẩm nối tiếp; Week9.md 1.10). Cố ý KHÔNG kiểm định dạng: slug lạ chỉ không khớp shop nào ⇒ danh sách rỗng
  // (tham số hoá, không có đường tấn công), và trang shop với slug gõ sai ra 404 từ API shop thay vì 400 làm
  // vỡ trang. Chỉ chặn độ dài. Kết hợp AND với `shopId` nếu có; vẫn luôn bắt buộc product PUBLISHED + shop
  // APPROVED nên shop chưa duyệt không lộ sản phẩm qua đường này.
  shopSlug: z
    .string()
    .trim()
    .max(SHOP_SLUG_MAX_LENGTH)
    .optional()
    .transform((val) => (val === '' ? undefined : val)),
  categoryId: z.string().trim().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  // Lọc theo giá trị thuộc tính (màu/size...) — không tra theo tên attribute
  // cụ thể (đúng tinh thần "attribute không cố định cứng theo 1 ngành
  // hàng", note-db.md mục 2): product khớp nếu CÓ variant active mang giá
  // trị đó, mỗi giá trị trong mảng lọc độc lập (AND giữa các giá trị, không
  // cần cùng 1 variant) — giống hành vi facet filter thực tế (Shopee/Lazada).
  attributeValues: z
    .union([
      z.string().max(PRODUCT_ATTRIBUTE_FILTER_VALUE_MAX_LENGTH),
      z
        .array(z.string().max(PRODUCT_ATTRIBUTE_FILTER_VALUE_MAX_LENGTH))
        .max(PRODUCT_ATTRIBUTE_FILTER_MAX_VALUES),
    ])
    .optional()
    .transform((val) => (val === undefined ? undefined : Array.isArray(val) ? val : [val])),
  // Search full-text (Week5.md Bước 1.6/1.8-1.9) — mở rộng GET /products có
  // sẵn thay vì tách endpoint riêng, kết hợp AND với các filter khác ở trên.
  // Cắt (không từ chối) chuỗi quá dài: người dùng dán một đoạn dài vào ô tìm kiếm thì vẫn ra kết quả theo
  // phần đầu thay vì nhận 400 làm vỡ trang. Cắt theo code point để không chẻ đôi cặp surrogate.
  q: z
    .string()
    .trim()
    .optional()
    .transform((val) =>
      val === undefined ? undefined : Array.from(val).slice(0, PRODUCT_SEARCH_MAX_LENGTH).join(''),
    ),
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
  ...ratingShape,
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
