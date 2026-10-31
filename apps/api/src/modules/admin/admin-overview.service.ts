import { Injectable } from '@nestjs/common';
import type { AdminOverview } from '@ecommerce/types';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RefundQueryService } from '../order/refund-query.service';

// Việc đang chờ Admin (Week11.md 2.5) — số đếm TRỰC TIẾP từ dữ liệu, không cache (rules/frontend.md mục 13: trang quản trị
// phải thấy ngay). Mỗi số dùng ĐÚNG điều kiện của tab tương ứng để con số ở trang tổng quan và `total` của tab là một:
//  - shop chờ duyệt: cùng `where: { status: 'PENDING' }` của AdminService.listShops;
//  - ba số của khu hoàn tiền: RefundQueryService.countOpenWork (dùng chung bộ lọc với ba tab /admin/refund-requests,
//    /admin/refunds, /admin/refundable-payments).
// Số của người dùng / báo cáo / kháng nghị sẽ thêm vào đây ở Bước 3–5. Các truy vấn độc lập nên chạy song song.
@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refundQueryService: RefundQueryService,
  ) {}

  async getOverview(): Promise<AdminOverview> {
    const [pendingShops, openReports, refundWork] = await Promise.all([
      this.prisma.shop.count({ where: { status: 'PENDING' } }),
      // Cùng điều kiện với tab "Chờ xử lý" của GET /admin/reports (status = OPEN).
      this.prisma.report.count({ where: { status: 'OPEN' } }),
      this.refundQueryService.countOpenWork(),
    ]);
    return { pendingShops, openReports, ...refundWork };
  }
}
