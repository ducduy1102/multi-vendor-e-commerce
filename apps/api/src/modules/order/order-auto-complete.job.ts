import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { OrderActionService } from './order-action.service';
import { findAutoCompleteCandidates } from './order-auto-complete-candidates';
import { readOrderAutoCompleteDays } from './order-config';

// Số đơn xử lý tối đa mỗi lượt — job chạy mỗi giờ nên phần còn lại được dọn ở lượt sau.
const BATCH_SIZE = 50;

// Job định kỳ tự hoàn tất đơn đã giao mà buyer không bấm "Đã nhận hàng" sau N ngày (Week8.md 1.7, 2.9).
// Chỉ tìm ứng viên rồi gọi ĐÚNG `OrderActionService.autoCompleteShipped` — dùng chung đường hoàn tất với
// buyer bấm tay (cùng OrderStatusService.transition + thu tiền COD), không tự viết SQL/logic ở đây.
// Constructor RẺ và KHÔNG throw (rules/backend.md mục 8): chỉ inject, không đọc ENV lúc khởi tạo.
// Seller KHÔNG tự hoàn tất đơn được (tránh tự "hoàn tất" để nhận tiền khi chưa giao) — chỉ buyer hoặc job này.
@Injectable()
export class OrderAutoCompleteJob {
  private readonly logger = new Logger(OrderAutoCompleteJob.name);
  // Cờ chống chạy chồng: 1 lượt chưa xong mà tới giờ sau thì bỏ qua — instance job là singleton nên biến
  // instance đủ dùng, không cần khoá phân tán (cùng PaymentExpiryJob).
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderActionService: OrderActionService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Previous run is still in progress — skipping this tick',
      );
      return;
    }
    this.isRunning = true;
    try {
      await this.completeOverdueOrders();
    } catch (error) {
      this.logger.error(
        'Unexpected error in OrderAutoCompleteJob',
        error instanceof Error ? error.stack : error,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async completeOverdueOrders(): Promise<void> {
    const days = readOrderAutoCompleteDays();
    const orderIds = await findAutoCompleteCandidates(this.prisma, {
      take: BATCH_SIZE,
      now: new Date(),
      days,
    });
    if (orderIds.length === 0) return;

    // Mỗi đơn 1 transaction riêng (bên trong autoCompleteShipped) — lỗi ở 1 đơn KHÔNG chặn các đơn
    // khác, chỉ log rồi đi tiếp.
    let completedCount = 0;
    for (const orderId of orderIds) {
      try {
        if (await this.orderActionService.autoCompleteShipped(orderId, days)) {
          completedCount += 1;
        }
      } catch (error) {
        this.logger.error(
          `Failed to auto-complete order=${orderId}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
    // Chỉ log khi thật sự có xử lý — tránh spam log mỗi giờ lúc không có gì để làm.
    if (completedCount > 0) {
      this.logger.log(
        `Auto-completed ${completedCount}/${orderIds.length} order(s) shipped more than ${days} day(s) ago`,
      );
    }
  }
}
