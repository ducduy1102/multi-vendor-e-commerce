import { useQuery } from '@tanstack/react-query';

import * as voucherService from '../services/voucher.service';

export function shopVouchersQueryKey(shopId: string) {
  return ['vouchers', 'shop', shopId] as const;
}

// Danh sách voucher của shop mình (mọi trạng thái, kể cả đã tắt/hết hạn).
// shopId do page.tsx (composition root) truyền xuống — module voucher không
// tự biết "shop của tôi" (không cross-import modules/shop).
export function useShopVouchers(shopId: string) {
  return useQuery({
    queryKey: shopVouchersQueryKey(shopId),
    queryFn: async () => (await voucherService.listShopVouchers(shopId)).items,
  });
}
