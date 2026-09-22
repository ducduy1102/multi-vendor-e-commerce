import { useMutation, useQueryClient } from '@tanstack/react-query';

import { archiveProduct } from '../services/product.service';
import type { ProductListItem } from '../types';
import { myProductsQueryKey } from './useMyProducts';
import { productQueryKey } from './useProduct';

// Prefix chung cho mọi query "sản phẩm của tôi" (myProductsQueryKey thêm
// shopId ở sau) — dùng để optimistic-update/rollback đúng cache mà không
// cần biết shopId ngay trong mutationFn (mutationFn chỉ nhận id sản phẩm).
const MY_PRODUCTS_QUERY_PREFIX = ['products', 'mine'] as const;

// Optimistic update: đổi status thành ARCHIVED ngay trong cache khi bấm,
// không chờ round-trip API — UI phản hồi tức thì. onError rollback lại
// đúng dữ liệu cũ đã snapshot ở onMutate (không phải refetch), onSettled
// mới invalidate để đồng bộ lại với server (cả khi thành công lẫn thất
// bại, đảm bảo cache không lệch server về lâu dài).
export function useArchiveProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => archiveProduct(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: MY_PRODUCTS_QUERY_PREFIX });
      const previous = queryClient.getQueriesData<ProductListItem[]>({
        queryKey: MY_PRODUCTS_QUERY_PREFIX,
      });
      queryClient.setQueriesData<ProductListItem[]>({ queryKey: MY_PRODUCTS_QUERY_PREFIX }, (old) =>
        old?.map((product) => (product.id === id ? { ...product, status: 'ARCHIVED' } : product)),
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
