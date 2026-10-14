import { useMutation } from '@tanstack/react-query';

import { useAuthStore } from '@/modules/auth';

import * as accountService from '../services/account.service';
import type { UpdateProfileInput } from '../types';

// Lưu hồ sơ rồi ghi user mới vào `useAuthStore` — nguồn duy nhất cho "user hiện tại" (Header, AccountSheet
// đọc tên từ đây nên cập nhật ngay, không cần tải lại trang). Không có query key nào để làm mới: user không
// nằm trong TanStack Query (rules/frontend.md mục 3).
export function useUpdateProfile() {
  const setUser = useAuthStore((state) => state.setUser);

  return useMutation({
    mutationFn: (input: UpdateProfileInput) => accountService.updateProfile(input),
    onSuccess: (user) => setUser(user),
  });
}
