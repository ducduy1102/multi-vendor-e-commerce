import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  readRefundMaxAttempts,
  REFUND_PENDING_STALE_MS,
} from './refund-config';
import {
  findExhaustedStaleRefunds,
  findOverdueRefundRequests,
  findRetryableStaleRefunds,
} from './refund-job-candidates';
import { RefundRequestActionService } from './refund-request-action.service';
import { RefundService } from './refund.service';

// Số bản ghi xử lý tối đa MỖI LƯỢT QUÉT — job chạy mỗi 15 phút nên phần còn lại được dọn ở lượt sau.
const BATCH_SIZE = 50;

// Job định kỳ lo hai việc "tới hạn" của hủy/hoàn tiền (Week9.md 1.5, 2.8). Chỉ tìm ứng viên rồi gọi ĐÚNG các
// service nghiệp vụ — không tự viết SQL/logic ở đây (cùng tinh thần OrderAutoCompleteJob/PaymentExpiryJob):
//  1. Yêu cầu hủy/trả hàng mà seller im lặng quá `REFUND_SELLER_RESPONSE_HOURS`: HỦY ⇒ tự duyệt, TRẢ HÀNG ⇒
//     chuyển Admin (`RefundRequestActionService.resolveOverdueRequest`).
//  2. Khoản hoàn tiền PENDING bị bỏ dở (crash giữa Tx1 và Tx2, cổng treo): còn lượt thử ⇒ gọi lại cổng bằng cùng
//     mã tham chiếu (`RefundService.executeRefund`), hết `REFUND_MAX_ATTEMPTS` ⇒ FAILED cho Admin
//     (`RefundService.failExhaustedRefund`). FAILED do chính cổng từ chối KHÔNG được thử lại tự động.
// Constructor RẺ và KHÔNG throw (rules/backend.md mục 8): chỉ inject, không đọc ENV lúc khởi tạo. Chạy nhiều
// instance vẫn đúng vì mọi bước ghi là UPDATE có điều kiện, chỉ tốn công thừa.
@Injectable()
export class RefundJob {
  private readonly logger = new Logger(RefundJob.name);
  // Cờ chống chạy chồng: 1 lượt chưa xong mà tới giờ sau thì bỏ qua — instance job là singleton nên biến
  // instance đủ dùng, không cần khoá phân tán (cùng PaymentExpiryJob/OrderAutoCompleteJob).
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly refundRequestActionService: RefundRequestActionService,
    private readonly refundService: RefundService,
  ) {}

  @Cron('*/15 * * * *')
  async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Previous run is still in progress — skipping this tick',
      );
      return;
    }
    this.isRunning = true;
    try {
      // Hai lượt độc lập: lượt 1 hỏng (vd lỗi truy vấn) không được chặn lượt 2 dọn tiền bị bỏ dở.
      await this.runPass('resolveOverdueRequests', () =>
        this.resolveOverdueRequests(),
      );
      await this.runPass('sweepStuckRefunds', () => this.sweepStuckRefunds());
    } finally {
      this.isRunning = false;
    }
  }

  private async runPass(
    name: string,
    pass: () => Promise<void>,
  ): Promise<void> {
    try {
      await pass();
    } catch (error) {
      this.logger.error(
        `Unexpected error in RefundJob.${name}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  // Lượt 1: yêu cầu quá hạn phản hồi của seller. Mỗi yêu cầu có transaction riêng (bên trong service) — lỗi ở 1
  // yêu cầu KHÔNG chặn các yêu cầu khác, chỉ log rồi đi tiếp.
  private async resolveOverdueRequests(): Promise<void> {
    const now = new Date();
    const requestIds = await findOverdueRefundRequests(this.prisma, {
      take: BATCH_SIZE,
      now,
    });
    if (requestIds.length === 0) return;

    let approvedCount = 0;
    let escalatedCount = 0;
    for (const requestId of requestIds) {
      try {
        const outcome =
          await this.refundRequestActionService.resolveOverdueRequest(
            requestId,
            now,
          );
        if (outcome === 'APPROVED') approvedCount += 1;
        if (outcome === 'ESCALATED') escalatedCount += 1;
      } catch (error) {
        this.logger.error(
          `Failed to resolve overdue refund request=${requestId}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
    // Chỉ log khi thật sự có xử lý — tránh spam log mỗi 15 phút lúc không có gì để làm.
    if (approvedCount + escalatedCount > 0) {
      this.logger.log(
        `Resolved ${approvedCount + escalatedCount}/${requestIds.length} overdue refund request(s): ${approvedCount} auto-approved, ${escalatedCount} escalated to admin`,
      );
    }
  }

  // Lượt 2: khoản hoàn PENDING bị bỏ dở. Thử lại các khoản còn lượt TRƯỚC, rồi mới đánh FAILED các khoản đã hết
  // lượt — hai tập rời nhau (attempts < max / >= max) nên thứ tự chỉ để log dễ đọc.
  private async sweepStuckRefunds(): Promise<void> {
    const query = {
      take: BATCH_SIZE,
      now: new Date(),
      staleMs: REFUND_PENDING_STALE_MS,
      maxAttempts: readRefundMaxAttempts(),
    };

    const retryIds = await findRetryableStaleRefunds(this.prisma, query);
    let retriedCount = 0;
    for (const refundId of retryIds) {
      try {
        await this.refundService.executeRefund(refundId);
        retriedCount += 1;
      } catch (error) {
        this.logger.error(
          `Failed to retry stuck refund=${refundId}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }

    const exhaustedIds = await findExhaustedStaleRefunds(this.prisma, query);
    let failedCount = 0;
    for (const refundId of exhaustedIds) {
      try {
        if (
          await this.refundService.failExhaustedRefund(
            refundId,
            query.maxAttempts,
          )
        ) {
          failedCount += 1;
        }
      } catch (error) {
        this.logger.error(
          `Failed to close exhausted refund=${refundId}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }

    if (retriedCount + failedCount > 0) {
      this.logger.log(
        `Stuck refunds: retried ${retriedCount}/${retryIds.length}, marked ${failedCount}/${exhaustedIds.length} as failed after ${query.maxAttempts} attempt(s)`,
      );
    }
  }
}
