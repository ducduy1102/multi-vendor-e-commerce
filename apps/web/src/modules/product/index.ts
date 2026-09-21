// Barrel export cho module product — export component/hook cần dùng ở app/.
// CategoryShortcutList/getTopLevelCategories KHÔNG export ở đây nữa — chỉ
// còn HomeCatalog.tsx dùng (qua import tương đối cùng thư mục), không còn
// consumer nào ở app/ cần trực tiếp sau khi page.tsx chuyển sang compose
// HomeCatalog thay vì tự gọi 2 thứ này.
export { createProductSchema, updateProductSchema } from './schemas/product.schema';
export { CreateProductFormContainer } from './components/CreateProductFormContainer';
export { EditProductFormContainer } from './components/EditProductFormContainer';
export { HomeCatalog } from './components/HomeCatalog';
export { HomeCatalogSkeleton } from './components/HomeCatalogSkeleton';
export { ProductFilterBar } from './components/ProductFilterBar';
export { ProductForm } from './components/ProductForm';
export { ProductPagination } from './components/ProductPagination';
export { ProductPreviewCard } from './components/ProductPreviewCard';
export { SellerProductsContainer } from './components/SellerProductsContainer';
export { useArchiveProduct } from './hooks/useArchiveProduct';
export { useCategories } from './hooks/useCategories';
export { useCreateProduct } from './hooks/useCreateProduct';
export { useMyProducts } from './hooks/useMyProducts';
export { useProduct } from './hooks/useProduct';
export { useProducts } from './hooks/useProducts';
export { useUpdateProduct } from './hooks/useUpdateProduct';
export { useUploadSignature } from './hooks/useUploadSignature';
export * as productService from './services/product.service';
export type {
  CreateProductInput,
  UpdateProductInput,
  Product,
  ProductListItem,
  ProductCard,
  ListProductsQuery,
  ProductListResponse,
  Category,
} from './types';
