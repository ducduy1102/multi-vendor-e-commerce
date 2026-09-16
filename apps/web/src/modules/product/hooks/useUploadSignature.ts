import { useMutation } from '@tanstack/react-query';

import { getUploadSignature } from '../services/product.service';

// useMutation (không phải useQuery) — chữ ký gắn timestamp hiện tại, không
// nên cache/tái sử dụng giữa các lần upload khác nhau (mỗi ảnh cần 1
// signature mới lúc bấm upload).
export function useUploadSignature() {
  return useMutation({
    mutationFn: getUploadSignature,
  });
}
