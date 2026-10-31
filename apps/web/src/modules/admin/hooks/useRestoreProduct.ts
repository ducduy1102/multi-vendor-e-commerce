import { useMutation } from '@tanstack/react-query';

import * as adminService from '../services/admin.service';
import type { RestoreProductInput } from '../types';

interface RestoreProductVariables extends RestoreProductInput {
  productId: string;
}

// Khôi phục sản phẩm đã bị sàn gỡ (sửa nhầm). Không có truy vấn nào của khu Admin hiển thị trạng thái hiện tại của sản phẩm (báo cáo chỉ giữ
// ảnh chụp lúc báo) nên không cần làm mới cache: nơi gọi tự ghi nhớ "đã khôi phục" trong lần hiển thị này (cùng cách `useUnhideReview`).
export function useRestoreProduct() {
  return useMutation({
    mutationFn: ({ productId, ...input }: RestoreProductVariables) =>
      adminService.restoreProduct(productId, input),
  });
}
