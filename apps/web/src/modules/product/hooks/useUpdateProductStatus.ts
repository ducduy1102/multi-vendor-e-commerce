import { useMutation, useQueryClient } from '@tanstack/react-query';

import { archiveProduct, updateProduct } from '../services/product.service';
import type { ProductListItem } from '../types';
import { myProductsQueryKey } from './useMyProducts';
import { productQueryKey } from './useProduct';

// Prefix chung cho mọi query "sản phẩm của tôi" (myProductsQueryKey thêm
// shopId ở sau) — dùng để optimistic-update/rollback đúng cache mà không
// cần biết shopId ngay trong mutationFn (mutationFn chỉ nhận id sản phẩm).
const MY_PRODUCTS_QUERY_PREFIX = ['products', 'mine'] as const;

// Chỉ 2 chiều chuyển trạng thái nhanh từ danh sách Seller (không qua
// ProductForm đầy đủ): "Lưu trữ" và "Mở lại" — "Mở lại" luôn đưa về DRAFT
// (không PUBLISHED), tránh vô tình đưa sản phẩm lên bán lại ngoài ý muốn;
// seller tự bấm "Đăng bán" trong ProductForm nếu thực sự muốn publish lại.
export type ProductStatusTarget = 'DRAFT' | 'ARCHIVED';

// ARCHIVED giữ đúng endpoint archiveProduct() (DELETE /products/:id,
// soft-delete ở BE) đã có sẵn thay vì đổi sang updateProduct() PATCH — không
// đổi hành vi/endpoint của action archive hiện tại, chỉ tổng quát hoá phần
// state/cache dùng chung với "Mở lại" (PATCH qua updateProduct()).
function callUpdateStatusApi(id: string, status: ProductStatusTarget) {
  return status === 'ARCHIVED' ? archiveProduct(id) : updateProduct(id, { status });
}

// Optimistic update: đổi status trong cache ngay khi bấm, không chờ round-
// trip API — UI phản hồi tức thì. onError rollback lại đúng dữ liệu cũ đã
// snapshot ở onMutate (không phải refetch), onSettled mới invalidate để
// đồng bộ lại với server (cả khi thành công lẫn thất bại, đảm bảo cache
// không lệch server về lâu dài). Dùng chung cho cả 2 chiều — gọi
// useUpdateProductStatus('ARCHIVED') và useUpdateProductStatus('DRAFT') ở 2
// nơi riêng trong SellerProductsContainer, mỗi lời gọi là 1 mutation
// instance riêng (pending state của "Lưu trữ" không lẫn với "Mở lại").
export function useUpdateProductStatus(status: ProductStatusTarget) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => callUpdateStatusApi(id, status),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: MY_PRODUCTS_QUERY_PREFIX });
      const previous = queryClient.getQueriesData<ProductListItem[]>({
        queryKey: MY_PRODUCTS_QUERY_PREFIX,
      });
      queryClient.setQueriesData<ProductListItem[]>({ queryKey: MY_PRODUCTS_QUERY_PREFIX }, (old) =>
        old?.map((product) => (product.id === id ? { ...product, status } : product)),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      context?.previous.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSettled: (product, _err, id) => {
      void queryClient.invalidateQueries({ queryKey: productQueryKey(product?.id ?? id) });
      void queryClient.invalidateQueries({
        queryKey: product ? myProductsQueryKey(product.shopId) : MY_PRODUCTS_QUERY_PREFIX,
      });
    },
  });
}
