// Barrel export cho module product — export component/hook cần dùng ở app/.
export { createProductSchema, updateProductSchema } from './schemas/product.schema';
export { CategoryShortcutList } from './components/CategoryShortcutList';
export { CreateProductFormContainer } from './components/CreateProductFormContainer';
export { EditProductFormContainer } from './components/EditProductFormContainer';
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
