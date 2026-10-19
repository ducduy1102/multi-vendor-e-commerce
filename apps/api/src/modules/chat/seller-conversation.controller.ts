import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  conversationListQuerySchema,
  messageListQuerySchema,
  sendMessageSchema,
  type ConversationListQuery,
  type MessageListQuery,
  type SendMessageInput,
} from '@ecommerce/types';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { ShopOwnerContext } from '../../shared/decorators/shop-owner-context.decorator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ShopOwnerGuard } from '../../shared/guards/shop-owner.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  errorExample,
  UNAUTHORIZED_EXAMPLE,
} from '../../shared/swagger/error-examples';
import {
  ApiListConversations,
  ApiListMessages,
  ApiMarkRead,
  ApiSendMessage,
  ApiUnreadCount,
  SHOP_ID_PARAM,
} from './chat-swagger';
import { ChatService, type ChatActor } from './chat.service';

// `chat` không được import `modules/auth` (module-boundaries.spec.ts): chỉ cần `userId` do JwtAuthGuard gán.
interface Caller {
  userId: string;
}

// Hộp thư của SHOP (Week10.md 4.6): cùng bộ thao tác với người mua nhưng dưới shops/:shopId/conversations.
// ShopOwnerGuard xác nhận shop thuộc người gọi (403 nếu không, 404 nếu shop không tồn tại) và gán `shopId` vào
// context — handler chỉ tin `shopId` đó, không bao giờ đọc shopId từ body/query. Service vẫn kiểm lại chủ shop
// và việc hội thoại thuộc đúng shop này (lớp thứ hai), nên hội thoại của shop khác luôn ra 404. KHÔNG kiểm trạng
// thái shop ở đây: shop bị khoá vẫn đọc và đánh dấu đã đọc được; chỉ việc GỬI bị chặn (409) ở service.
// Chủ shop không mở được hội thoại — chỉ người mua bắt đầu (D6) — nên không có route POST tạo.
@ApiTags('chat')
@Controller('shops/:shopId/conversations')
@UseGuards(JwtAuthGuard, ShopOwnerGuard)
@ApiCookieAuth('access_token')
@ApiParam(SHOP_ID_PARAM)
@ApiResponse({
  status: 401,
  description: 'Chưa đăng nhập',
  schema: { example: UNAUTHORIZED_EXAMPLE },
})
@ApiResponse({
  status: 403,
  description: 'Không phải chủ shop',
  schema: { example: errorExample('Not the shop owner') },
})
export class SellerConversationController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiListConversations('seller')
  list(
    @CurrentUser() user: Caller,
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Query(new ZodValidationPipe(conversationListQuerySchema))
    query: ConversationListQuery,
  ) {
    return this.chatService.listConversations(asShop(user, shopId), query);
  }

  @Get('unread-count')
  @Header('Cache-Control', 'no-store')
  @ApiUnreadCount('seller')
  unreadCount(
    @CurrentUser() user: Caller,
    @ShopOwnerContext() { shopId }: { shopId: string },
  ) {
    return this.chatService.unreadCount(asShop(user, shopId));
  }

  @Get(':id/messages')
  @Header('Cache-Control', 'no-store')
  @ApiListMessages('seller')
  listMessages(
    @CurrentUser() user: Caller,
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('id') conversationId: string,
    @Query(new ZodValidationPipe(messageListQuerySchema))
    query: MessageListQuery,
  ) {
    return this.chatService.listMessages(
      asShop(user, shopId),
      conversationId,
      query,
    );
  }

  // 201 khi ghi tin mới, 200 khi gửi lại tin ĐÃ nhận — cùng cách làm với ConversationController.send.
  @Post(':id/messages')
  @ApiSendMessage('seller')
  async send(
    @CurrentUser() user: Caller,
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { message, replayed } = await this.chatService.sendMessage(
      asShop(user, shopId),
      conversationId,
      body,
    );
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return message;
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiMarkRead('seller')
  markRead(
    @CurrentUser() user: Caller,
    @ShopOwnerContext() { shopId }: { shopId: string },
    @Param('id') conversationId: string,
  ) {
    return this.chatService.markRead(asShop(user, shopId), conversationId);
  }
}

const asShop = (user: Caller, shopId: string): ChatActor => ({
  kind: 'SHOP',
  userId: user.userId,
  shopId,
});
