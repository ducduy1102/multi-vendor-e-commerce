import { Module } from '@nestjs/common';
import { NotificationModule } from '../../shared/notification/notification.module';
import { PrismaReportTargetDirectory } from './prisma-report-target-directory';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { REPORT_TARGET_DIRECTORY } from './report-target-directory';

// Phía NGƯỜI BÁO của báo cáo vi phạm (Week11.md 5.3): gửi báo cáo. Phía ADMIN (hàng đợi + xử lý) nằm ở modules/admin vì nó điều phối
// việc ẩn đánh giá, khoá shop, gỡ sản phẩm... `report` là module LÁ: không import module nghiệp vụ nào (module-boundaries.spec.ts).
// Thông tin về đối tượng bị báo (đánh giá, hội thoại, shop, sản phẩm) đi qua cổng REPORT_TARGET_DIRECTORY — đổi bản cài đặt ở dòng
// provider dưới đây là đủ khi tách thành service riêng. Hạ tầng dùng chung (guard, thông báo) ở shared/.
@Module({
  imports: [NotificationModule],
  controllers: [ReportController],
  providers: [
    ReportService,
    { provide: REPORT_TARGET_DIRECTORY, useClass: PrismaReportTargetDirectory },
  ],
})
export class ReportModule {}
