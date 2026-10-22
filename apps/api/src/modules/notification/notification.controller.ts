import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  listNotificationsQuerySchema,
  type ListNotificationsQuery,
} from '@ecommerce/types';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { UNAUTHORIZED_EXAMPLE } from '../../shared/swagger/error-examples';
import { NotificationInboxService } from './notification-inbox.service';
import {
  ApiListNotifications,
  ApiMarkAllNotificationsRead,
  ApiMarkNotificationRead,
  ApiNotificationUnreadCount,
} from './notification-swagger';

// `notification` không được import `modules/auth` (module-boundaries.spec.ts) nên không dùng AuthenticatedUser: chỉ cần
// biết người gọi là ai, mà JwtAuthGuard đã gán `req.user.userId`.
interface Caller {
  userId: string;
}

// Hộp thông báo của CHÍNH người gọi (Week10.md 7.6). Chỉ cần đăng nhập (JwtAuthGuard) — KHÔNG đòi EmailVerifiedGuard: xem
// thông báo không phải thao tác lạm dụng được, và người chưa xác thực email vẫn cần biết (vd đơn của họ đã được xác nhận).
// Không route nào nhận userId từ client: mọi truy vấn gắn với `req.user`. Dữ liệu riêng tư nên các GET trả
// `Cache-Control: no-store`.
@ApiTags('notification')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth('access_token')
@ApiResponse({
  status: 401,
  description: 'Chưa đăng nhập',
  schema: { example: UNAUTHORIZED_EXAMPLE },
})
export class NotificationController {
  constructor(private readonly inbox: NotificationInboxService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiListNotifications()
  list(
    @CurrentUser() user: Caller,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema))
    query: ListNotificationsQuery,
  ) {
    return this.inbox.list(user.userId, query);
  }

  @Get('unread-count')
  @Header('Cache-Control', 'no-store')
  @ApiNotificationUnreadCount()
  unreadCount(@CurrentUser() user: Caller) {
    return this.inbox.unreadCount(user.userId);
  }

  // Đặt TRƯỚC `:id/read` cho dễ đọc; hai đường dẫn không đụng nhau (một đoạn so với hai đoạn).
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiMarkAllNotificationsRead()
  markAllRead(@CurrentUser() user: Caller) {
    return this.inbox.markAllRead(user.userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiMarkNotificationRead()
  markRead(@CurrentUser() user: Caller, @Param('id') id: string) {
    return this.inbox.markRead(user.userId, id);
  }
}
