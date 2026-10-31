import { useMutation } from '@tanstack/react-query';

import { createReport } from '../services/report.service';
import type { CreateReportInput } from '../types';

// `networkMode: 'always'`: mặc định 'online' của TanStack Query TREO mutation khi `navigator.onLine === false` (không gọi API, không
// lỗi) nên nút kẹt ở "Đang gửi..." mãi. Luôn thử gửi: mất mạng thật thì fetch lỗi ngay và người dùng thấy câu lỗi chung
// (rules/frontend.md mục 7, mục (16) về chat). Không có truy vấn nào cần làm mới sau khi báo: người báo không có danh sách báo cáo.
export function useCreateReport() {
  return useMutation({
    mutationFn: (input: CreateReportInput) => createReport(input),
    networkMode: 'always',
  });
}
