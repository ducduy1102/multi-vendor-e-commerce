import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { readPaymentReclaimGraceMinutes } from '../../shared/payment/payment-config';
import { findReclaimCandidates } from './payment-expiry-candidates';
import { PaymentService } from './payment.service';

// Số nhóm xử lý tối đa mỗi lượt (Week7.md 1.4) — job chạy mỗi phút nên phần còn lại được dọn ở lượt
// sau, không cần quét hết trong 1 lần.
const BATCH_SIZE = 50;

// Job định kỳ thu hồi giữ chỗ quá hạn (Week7.md 1.4, 2.10) — chỉ tìm ứng viên rồi gọi ĐÚNG
// `PaymentService.reclaimCheckoutGroup` (dùng chung với hết hạn "lười" ở `getCheckoutGroup`/
// `retryPayment`, 2.9); không tự viết SQL kho/voucher ở đây. Constructor RẺ và KHÔNG throw
// (`rules/backend.md` mục 8) — chỉ inject, không đọc ENV/kết nối gì lúc khởi tạo.
@Injectable()
export class PaymentExpiryJob {
  private readonly logger = new Logger(PaymentExpiryJob.name);
  // Cờ chống chạy chồng (Week7.md 1.4): 1 lượt chưa xong mà tới phút sau thì bỏ qua, không xếp
  // hàng — instance job là singleton nên biến instance đủ dùng, không cần khoá phân tán.
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Previous run is still in progress — skipping this tick',
      );
      return;
    }
    this.isRunning = true;
    try {
      await this.reclaimExpiredGroups();
    } catch (error) {
      this.logger.error(
        'Unexpected error in PaymentExpiryJob',
        error instanceof Error ? error.stack : error,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async reclaimExpiredGroups(): Promise<void> {
    const graceMs = readPaymentReclaimGraceMinutes() * 60_000;
    const groupIds = await findReclaimCandidates(this.prisma, {
      take: BATCH_SIZE,
      now: new Date(),
      graceMs,
    });
    if (groupIds.length === 0) return;

    // Mỗi nhóm 1 transaction riêng (bên trong reclaimCheckoutGroup) — lỗi ở 1 nhóm KHÔNG chặn các
    // nhóm khác, chỉ log rồi đi tiếp.
    let reclaimedCount = 0;
    for (const groupId of groupIds) {
      try {
        const { reclaimed } =
          await this.paymentService.reclaimCheckoutGroup(groupId);
        if (reclaimed) reclaimedCount += 1;
      } catch (error) {
        this.logger.error(
          `Failed to reclaim checkoutGroup=${groupId}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
    // Chỉ log khi thật sự có xử lý (Week7.md 1.4) — tránh spam log mỗi phút lúc không có gì để làm.
    if (reclaimedCount > 0) {
      this.logger.log(
        `Reclaimed ${reclaimedCount}/${groupIds.length} checkout group(s)`,
      );
    }
  }
}
