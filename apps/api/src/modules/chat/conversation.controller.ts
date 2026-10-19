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
import { ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  conversationListQuerySchema,
  messageListQuerySchema,
  openConversationSchema,
  sendMessageSchema,
  type ConversationListQuery,
  type MessageListQuery,
  type OpenConversationInput,
  type SendMessageInput,
} from '@ecommerce/types';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { EmailVerifiedGuard } from '../../shared/guards/email-verified.guard';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { UNAUTHORIZED_EXAMPLE } from '../../shared/swagger/error-examples';
import {
  ApiListConversations,
  ApiListMessages,
  ApiMarkRead,
  ApiOpenConversation,
  ApiSendMessage,
  ApiUnreadCount,
} from './chat-swagger';
import { ChatService, type ChatActor } from './chat.service';

// `chat` không được import `modules/auth` (module-boundaries.spec.ts) nên không dùng AuthenticatedUser: chỉ cần
// biết người gọi là ai, mà JwtAuthGuard đã gán `req.user.userId`.
interface Caller {
  userId: string;
}
const asBuyer = (user: Caller): ChatActor => ({
  kind: 'BUYER',
  userId: user.userId,
});

// Hộp thư của NGƯỜI MUA (Week10.md 4.6): mọi route chỉ gọi ChatService với vai BUYER — service tự kiểm người gọi
// có đúng là người mua của hội thoại không, nên một id hội thoại của người khác luôn ra 404. Chủ shop dùng bộ
// route riêng dưới shops/:shopId/conversations (SellerConversationController). Dữ liệu chat là riêng tư nên các
// GET trả `Cache-Control: no-store` (không để trình duyệt/proxy lưu bản sao).
@ApiTags('chat')
@Controller('conversations')
@UseGuards(JwtAuthGuard)
@ApiCookieAuth('access_token')
@ApiResponse({
  status: 401,
  description: 'Chưa đăng nhập',
  schema: { example: UNAUTHORIZED_EXAMPLE },
})
export class ConversationController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(EmailVerifiedGuard)
  @ApiOpenConversation()
  open(
    @CurrentUser() user: Caller,
    @Body(new ZodValidationPipe(openConversationSchema))
    body: OpenConversationInput,
  ) {
    return this.chatService.openConversation(user.userId, body.shopId);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiListConversations('buyer')
  list(
    @CurrentUser() user: Caller,
    @Query(new ZodValidationPipe(conversationListQuerySchema))
    query: ConversationListQuery,
  ) {
    return this.chatService.listConversations(asBuyer(user), query);
  }

  @Get('unread-count')
  @Header('Cache-Control', 'no-store')
  @ApiUnreadCount('buyer')
  unreadCount(@CurrentUser() user: Caller) {
    return this.chatService.unreadCount(asBuyer(user));
  }

  @Get(':id/messages')
  @Header('Cache-Control', 'no-store')
  @ApiListMessages('buyer')
  listMessages(
    @CurrentUser() user: Caller,
    @Param('id') conversationId: string,
    @Query(new ZodValidationPipe(messageListQuerySchema))
    query: MessageListQuery,
  ) {
    return this.chatService.listMessages(asBuyer(user), conversationId, query);
  }

  // 201 khi ghi tin mới, 200 khi gửi lại tin ĐÃ nhận (cùng clientMessageId) — status động theo `replayed` nên dùng
  // @Res({ passthrough: true }) như retryPayment ở checkout, không phải @HttpCode() tĩnh.
  @Post(':id/messages')
  @UseGuards(EmailVerifiedGuard)
  @ApiSendMessage('buyer')
  async send(
    @CurrentUser() user: Caller,
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { message, replayed } = await this.chatService.sendMessage(
      asBuyer(user),
      conversationId,
      body,
    );
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return message;
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiMarkRead('buyer')
  markRead(@CurrentUser() user: Caller, @Param('id') conversationId: string) {
    return this.chatService.markRead(asBuyer(user), conversationId);
  }
}
