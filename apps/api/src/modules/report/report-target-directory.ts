import type {
  ReportSnapshotByTarget,
  ReportTargetType,
} from '@ecommerce/types';

// Cổng "đối tượng bị báo" của module report (Week11.md 5.3, "Nguyên tắc để tách microservice sau"): mọi thứ report cần biết về miền
// KHÁC (đánh giá, hội thoại, shop, sản phẩm) đi qua giao diện này, không đọc bảng của miền khác rải rác trong ReportService — và
// `report` không import `review`/`chat`/`shop`/`product`. Bản chạy trong cùng tiến trình đọc thẳng DB với `select` hẹp
// (prisma-report-target-directory.ts); khi tách thành service riêng chỉ thay bản cài đặt.
export interface ResolvedReportTarget {
  // Đối tượng là của CHÍNH người báo (đánh giá do họ viết, shop/sản phẩm do họ làm chủ): không tự báo nội dung của mình (409).
  // Hội thoại luôn `false` — cả hai bên đều là thành viên, không bên nào là "chủ" của nó.
  ownedByReporter: boolean;
  // Ảnh chụp CHƯA kiểm: ReportService đưa qua `parseReportSnapshot` (strict + trần byte) trước khi ghi.
  snapshot: ReportSnapshotByTarget[ReportTargetType];
}

export interface ReportTargetDirectory {
  // Tra đối tượng THEO GÓC NHÌN CỦA NGƯỜI BÁO. `null` khi người đó không "thấy" được đối tượng — không tồn tại, không còn công khai,
  // hoặc (hội thoại) họ không phải thành viên: MỘT kết quả cho cả ba ca, nên người ngoài không dò được đối tượng có thật hay không.
  // Phải trả `null` (không ném lỗi) cho id không tồn tại.
  resolve(
    reporterId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<ResolvedReportTarget | null>;
}

// Token DI của cổng.
export const REPORT_TARGET_DIRECTORY = Symbol('REPORT_TARGET_DIRECTORY');
