// Dùng thẳng schema BE — form product không có field nào riêng ở FE ngoài
// những gì đã có trong createProductSchema/updateProductSchema, nên chỉ
// re-export (giống cách modules/shop/schemas/shop.schema.ts làm).
export { createProductSchema, updateProductSchema } from '@ecommerce/types';
