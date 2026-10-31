import { notFound } from 'next/navigation';

import { AdminReportDetailContainer, parseAdminReportId } from '@/modules/admin';

interface AdminReportDetailPageProps {
  params: Promise<{ id: string }>;
}

// Server Component mỏng: kiểm id là UUID (sai dạng ⇒ 404 ngay, không gọi API) rồi giao cho Container tải qua TanStack Query — dữ liệu quản
// trị theo session. Khung (nav, <main>, Container) do admin/layout.tsx lo; tiêu đề nằm trong Container vì nó phụ thuộc nội dung báo cáo.
export default async function AdminReportDetailPage({ params }: AdminReportDetailPageProps) {
  const reportId = parseAdminReportId((await params).id);
  if (!reportId) notFound();

  return <AdminReportDetailContainer reportId={reportId} />;
}
