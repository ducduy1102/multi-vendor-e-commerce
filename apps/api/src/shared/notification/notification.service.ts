import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notificationWriteSchema, REALTIME_EVENTS } from '@ecommerce/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  REALTIME_EMITTER,
  type RealtimeEmitter,
} from '../realtime/realtime-emitter';
import {
  buildNotifications,
  type NotificationDraft,
  type NotificationEvent,
} from './notification-events';
import { NotificationFactsLoader } from './notification-facts.loader';
import { toNotificationDto, type NotificationRow } from './notification.mapper';

const createdSelect = {
  id: true,
  userId: true,
  type: true,
  data: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

type CreatedRow = Prisma.NotificationGetPayload<{
  select: typeof createdSelect;
}>;

// Bên GHI của thông báo trong ứng dụng (Week10.md 7.3). Nơi gọi đưa vào MỘT sự kiện miền có kiểu; service tự suy ra
// người nhận và dữ liệu từ DB, kiểm bằng Zod, ghi bằng một câu `createManyAndReturn`, rồi đẩy `notification:new` tới
// từng người nhận.
//
// HỢP ĐỒNG với nơi gọi (cùng mẫu OrderEmailService, rules/backend.md mục 4):
//  - gọi SAU KHI DB đã commit, KHÔNG BAO GIỜ trong $transaction (rollback thì thao tác chính không xảy ra — không được
//    để lại thông báo về nó; và gọi DB/đẩy socket trong transaction giữ khoá lâu);
//  - `notify` KHÔNG BAO GIỜ ném và KHÔNG BAO GIỜ reject: thao tác nghiệp vụ đã thành công, thông báo hỏng chỉ được log
//    (người dùng vẫn thấy dữ liệu khi mở trang tương ứng) — đã chấp nhận là best-effort, outbox/BullMQ để Tuần 12;
//  - log CHỈ có loại sự kiện, id thông báo và mô tả lỗi đã lọc — không bao giờ nội dung thông báo (có thể chứa lý do do
//    người dùng nhập).
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facts: NotificationFactsLoader,
    @Inject(REALTIME_EMITTER) private readonly realtime: RealtimeEmitter,
  ) {}

  async notify(event: NotificationEvent): Promise<void> {
    try {
      const facts = await this.facts.load(event);
      if (!facts) {
        this.logger.warn(
          `Notification ${event.kind}: the source record no longer exists, nothing sent`,
        );
        return;
      }

      const drafts = this.validated(event, buildNotifications(event, facts));
      if (drafts.length === 0) return;

      const rows = await this.prisma.notification.createManyAndReturn({
        data: drafts.map((item) => ({
          userId: item.userId,
          type: item.type,
          data: item.data,
        })),
        select: createdSelect,
      });
      await this.publish(rows);
    } catch (error) {
      this.logger.error(
        `Creating notifications for ${event.kind} failed: ${describeError(error)}`,
      );
    }
  }

  // Bỏ (và log) từng thông báo không qua schema GHI thay vì để một cái hỏng làm mất cả lô: người nhận khác vẫn được
  // báo. Với chữ đã cắt gọn bởi buildNotifications, nhánh này chỉ xảy ra khi có lỗi lập trình (thêm loại mà quên schema).
  private validated(
    event: NotificationEvent,
    drafts: NotificationDraft[],
  ): NotificationDraft[] {
    return drafts.filter((item) => {
      const result = notificationWriteSchema.safeParse({
        type: item.type,
        data: item.data,
      });
      if (!result.success) {
        this.logger.error(
          `Notification ${item.type} from ${event.kind} dropped: ${result.error.issues
            .map(
              (issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`,
            )
            .join('; ')}`,
        );
      }
      return result.success;
    });
  }

  // Đẩy `notification:new` tới ĐÚNG người nhận của từng hàng (userId đọc từ hàng vừa ghi). Từng lần đẩy độc lập: một
  // người nhận lỗi không chặn người khác, và lỗi đẩy không bao giờ thành lỗi của `notify` (hợp đồng RealtimeEmitter là
  // best-effort, nhưng bản cài đặt khác có thể vi phạm nên vẫn bọc).
  private async publish(rows: CreatedRow[]): Promise<void> {
    await Promise.all(
      rows.map(async (row) => {
        try {
          await this.realtime.emitToUser(
            row.userId,
            REALTIME_EVENTS.notificationNew,
            toNotificationDto(row satisfies NotificationRow),
          );
        } catch (error) {
          this.logger.error(
            `Pushing notification ${row.id} failed: ${describeError(error)}`,
          );
        }
      }),
    );
  }
}

// Mô tả lỗi để log mà không làm lộ dữ liệu: `PrismaClientValidationError` in NGUYÊN giá trị đã truyền vào câu ghi và lỗi
// ràng buộc của Postgres có thể kèm cả hàng vi phạm (rules/backend.md mục 4, bài học từ chat) nên với lỗi Prisma chỉ
// log tên lỗi và mã; lỗi khác log thông điệp, cắt gọn.
function describeError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientValidationError) {
    return 'PrismaClientValidationError (details omitted: they contain the written values)';
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `PrismaClientKnownRequestError ${error.code}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}
