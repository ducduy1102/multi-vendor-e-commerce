// Barrel export cho module report (báo cáo vi phạm phía người dùng, Week11.md 5.6) — module LÁ: không import module nghiệp vụ nào và
// không module nào import nó (shared/lib/module-boundaries.test.ts). Nút "Báo cáo" được ghép ở page.tsx / app/[locale]/_components/
// ReportEntry (chỉ NẠP ĐỘNG cho người đã đăng nhập — khách vãng lai không tải mã báo cáo, shared/lib/guest-bundle.test.ts). Hàng đợi
// và xử lý của Admin nằm trong `modules/admin`, không phải ở đây. Không export sâu file nội bộ.
export { ReportButton } from './components/ReportButton';
export * as reportService from './services/report.service';
export type { CreateReportInput, ReportReasonCode, ReportReceipt, ReportTargetType } from './types';
