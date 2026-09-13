// Dùng thẳng schema BE — không có field nào riêng ở FE cho form shop (khác
// register cần thêm confirmPassword), nên chỉ re-export.
export { createShopSchema, updateShopSchema } from '@ecommerce/types';
