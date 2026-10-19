import { applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import {
  CHAT_CONVERSATIONS_PAGE_SIZE,
  CHAT_MAX_PAGE_SIZE,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_PAGE_SIZE,
} from '@ecommerce/types';
import { errorExample } from '../../shared/swagger/error-examples';

// Tài liệu Swagger của hai controller chat (người mua / chủ shop dùng CÙNG bộ thao tác, khác đường dẫn và guard).
// Gom thành decorator theo thao tác để hai controller không chép lại cả trang @ApiResponse. Status khai ở đây
// phải khớp status THỰC của route (xem chat.controller.int-spec.ts: test đối chiếu /docs-json với response thật).
export type ChatSide = 'buyer' | 'seller';

const CONVERSATION_ID = 'd1b2c3d4-1234-4a5b-8c9d-abcdef000010';
const SHOP_ID = 'c1b2c3d4-1234-4a5b-8c9d-abcdef000003';
const MESSAGE_ID = 'f1b2c3d4-1234-4a5b-8c9d-abcdef000020';
const CLIENT_MESSAGE_ID = '2c6f6d3a-8d4b-4f55-9a52-0d9a2b6a7c11';
const CURSOR =
  'MjAyNi0xMC0wMVQxMDowMDowMC4wMDBafGYxYjJjM2Q0LTEyMzQtNGE1Yi04YzlkLWFiY2RlZjAwMDAyMA';

export const SHOP_ID_PARAM = {
  name: 'shopId',
  description: 'ID shop của chính người gọi (ShopOwnerGuard kiểm chủ sở hữu)',
};
export const CONVERSATION_ID_PARAM = {
  name: 'id',
  description: 'ID hội thoại',
};

const MESSAGE_EXAMPLE = {
  id: MESSAGE_ID,
  conversationId: CONVERSATION_ID,
  senderRole: 'BUYER',
  content: 'Shop còn size M không ạ?',
  createdAt: '2026-10-01T10:00:00.000Z',
  clientMessageId: CLIENT_MESSAGE_ID,
};

const buyerSummaryExample = {
  id: CONVERSATION_ID,
  shopId: SHOP_ID,
  counterpart: {
    name: 'Shop Áo Xinh',
    logoUrl: 'https://res.cloudinary.com/demo/image/upload/logo.png',
  },
  lastMessage: {
    content: 'Còn nhé bạn',
    senderRole: 'SHOP',
    createdAt: '2026-10-01T10:05:00.000Z',
  },
  lastMessageAt: '2026-10-01T10:05:00.000Z',
  unreadCount: 1,
  isReadOnly: false,
};
const sellerSummaryExample = {
  ...buyerSummaryExample,
  counterpart: { name: 'Nguyễn Văn A', logoUrl: null },
  lastMessage: {
    content: 'Shop còn size M không ạ?',
    senderRole: 'BUYER',
    createdAt: '2026-10-01T10:00:00.000Z',
  },
  lastMessageAt: '2026-10-01T10:00:00.000Z',
};

const NOT_A_MEMBER_NOTE =
  'không tồn tại, của người khác hoặc đi nhầm đường dẫn của vai kia — không phân biệt, để không lộ hội thoại nào có thật';

function notFound(side: ChatSide, what: 'conversation' | 'shop') {
  const conversation = errorExample('Conversation not found');
  return ApiResponse({
    status: 404,
    description:
      side === 'seller'
        ? `Shop không tồn tại; hoặc hội thoại ${NOT_A_MEMBER_NOTE}`
        : `Hội thoại ${NOT_A_MEMBER_NOTE}`,
    schema: {
      example: what === 'shop' ? errorExample('Shop not found') : conversation,
    },
  });
}

const badRequest = (description: string, message: string) =>
  ApiResponse({
    status: 400,
    description,
    schema: { example: errorExample(message) },
  });

const actorName = (side: ChatSide) =>
  side === 'buyer' ? 'người mua' : 'chủ shop';

export function ApiOpenConversation() {
  return applyDecorators(
    ApiOperation({
      summary:
        'Người mua mở (hoặc lấy lại) hội thoại với một shop — idempotent: gọi lại trả đúng hội thoại cũ nên bấm đúp hay hai tab cùng bấm vẫn chỉ có một hội thoại. Luôn trả 200 (không phân biệt vừa tạo hay đã có). Cần email đã xác thực',
    }),
    ApiBody({ schema: { example: { shopId: SHOP_ID } } }),
    ApiResponse({
      status: 200,
      schema: {
        example: {
          success: true,
          data: {
            ...buyerSummaryExample,
            lastMessage: null,
            lastMessageAt: null,
            unreadCount: 0,
          },
        },
      },
    }),
    badRequest('shopId thiếu hoặc không phải UUID', 'shopId: Invalid uuid'),
    ApiResponse({
      status: 403,
      description: 'Email chưa xác thực',
      schema: {
        example: errorExample('EMAIL_NOT_VERIFIED', {
          code: 'EMAIL_NOT_VERIFIED',
        }),
      },
    }),
    ApiResponse({
      status: 404,
      description:
        'Shop không tồn tại hoặc chưa/không còn được duyệt — không phân biệt (giống trang công khai của shop)',
      schema: { example: errorExample('Shop not found') },
    }),
    ApiResponse({
      status: 409,
      description:
        'CHAT_OWN_SHOP = chủ shop không nhắn cho shop của chính mình',
      schema: {
        example: errorExample(
          'You cannot start a conversation with your own shop',
          { code: 'CHAT_OWN_SHOP' },
        ),
      },
    }),
    ApiResponse({
      status: 429,
      description:
        'CHAT_CONVERSATION_LIMIT = đã mở quá nhiều hội thoại MỚI trong 24 giờ (mở lại hội thoại đã có không tính)',
      schema: {
        example: errorExample(
          'Too many new conversations started recently, please try again later',
          { code: 'CHAT_CONVERSATION_LIMIT' },
        ),
      },
    }),
  );
}

export function ApiListConversations(side: ChatSide) {
  return applyDecorators(
    ApiOperation({
      summary:
        side === 'buyer'
          ? 'Hộp thư của người mua — các shop mình đã nhắn, tin mới nhất trước, phân trang theo con trỏ. Chỉ hội thoại ĐÃ có tin. Shop bị khoá vẫn hiện (isReadOnly = true)'
          : 'Hộp thư của shop mình — những người mua đã nhắn, tin mới nhất trước, phân trang theo con trỏ. Chỉ hội thoại ĐÃ có tin; đối phương chỉ có tên hiển thị (không email/SĐT). Shop bị khoá vẫn xem được (isReadOnly = true)',
    }),
    ApiQuery({
      name: 'before',
      required: false,
      description:
        'nextCursor của trang trước (chuỗi mờ, truyền lại nguyên trạng)',
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      example: CHAT_CONVERSATIONS_PAGE_SIZE,
      description: `Tối đa ${CHAT_MAX_PAGE_SIZE}`,
    }),
    ApiResponse({
      status: 200,
      schema: {
        example: {
          success: true,
          data: {
            items: [
              side === 'buyer' ? buyerSummaryExample : sellerSummaryExample,
            ],
            nextCursor: CURSOR,
          },
        },
      },
    }),
    badRequest(
      'Con trỏ sai định dạng hoặc limit ngoài 1..50',
      'Invalid cursor',
    ),
    ...(side === 'seller' ? [notFound(side, 'shop')] : []),
  );
}

export function ApiUnreadCount(side: ChatSide) {
  return applyDecorators(
    ApiOperation({
      summary:
        side === 'buyer'
          ? 'Tổng số tin chưa đọc của người mua (cho huy hiệu) trên mọi hội thoại của mình'
          : 'Tổng số tin chưa đọc của shop mình (cho huy hiệu) trên mọi hội thoại của shop — tách bạch với huy hiệu người mua của cùng một tài khoản',
    }),
    ApiResponse({
      status: 200,
      schema: { example: { success: true, data: { unreadCount: 3 } } },
    }),
    ...(side === 'seller' ? [notFound(side, 'shop')] : []),
  );
}

export function ApiListMessages(side: ChatSide) {
  return applyDecorators(
    ApiParam(CONVERSATION_ID_PARAM),
    ApiOperation({
      summary: `Một trang tin của hội thoại, MỚI NHẤT trước (${actorName(side)} là thành viên). Cho phép cả khi shop bị khoá (chỉ đọc). \`clientMessageId\` chỉ có trên tin do chính người gọi gửi`,
    }),
    ApiQuery({
      name: 'before',
      required: false,
      description:
        'nextCursor của trang trước (chuỗi mờ, truyền lại nguyên trạng)',
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      example: CHAT_PAGE_SIZE,
      description: `Tối đa ${CHAT_MAX_PAGE_SIZE}`,
    }),
    ApiResponse({
      status: 200,
      schema: {
        example: {
          success: true,
          data: {
            items: [
              {
                id: MESSAGE_ID,
                conversationId: CONVERSATION_ID,
                senderRole: 'SHOP',
                content: 'Còn nhé bạn',
                createdAt: '2026-10-01T10:05:00.000Z',
              },
              MESSAGE_EXAMPLE,
            ],
            nextCursor: null,
          },
        },
      },
    }),
    badRequest(
      'Con trỏ sai định dạng hoặc limit ngoài 1..50',
      'Invalid cursor',
    ),
    notFound(side, 'conversation'),
  );
}

export function ApiSendMessage(side: ChatSide) {
  return applyDecorators(
    ApiParam(CONVERSATION_ID_PARAM),
    ApiOperation({
      summary: `Gửi một tin (${actorName(side)}). IDEMPOTENT theo \`clientMessageId\` (UUID do client sinh cho mỗi lần bấm gửi, dùng lại NGUYÊN khi thử lại): tin mới ⇒ 201; gửi lại tin đã nhận ⇒ 200 và trả đúng tin cũ, không tạo bản sao, không đẩy lại sự kiện. Người nhận được đẩy \`chat:message\` qua socket. Nội dung là văn bản thuần 1..${CHAT_MESSAGE_MAX_LENGTH} ký tự (xuống dòng \`\\n\` được, ký tự điều khiển/NUL/bidi thì không).${side === 'buyer' ? ' Cần email đã xác thực.' : ''}`,
    }),
    ApiBody({
      schema: {
        example: {
          content: 'Shop còn size M không ạ?',
          clientMessageId: CLIENT_MESSAGE_ID,
        },
      },
    }),
    ApiResponse({
      status: 201,
      description: 'Tin mới được ghi',
      schema: { example: { success: true, data: MESSAGE_EXAMPLE } },
    }),
    ApiResponse({
      status: 200,
      description:
        'Gửi lại tin ĐÃ nhận (cùng clientMessageId): trả đúng tin cũ, không ghi thêm',
      schema: { example: { success: true, data: MESSAGE_EXAMPLE } },
    }),
    badRequest(
      'Nội dung rỗng / quá dài / có ký tự không an toàn, hoặc clientMessageId thiếu / không phải UUID',
      `content: chat.validationMessageTooLong`,
    ),
    ...(side === 'buyer'
      ? [
          ApiResponse({
            status: 403,
            description: 'Email chưa xác thực',
            schema: {
              example: errorExample('EMAIL_NOT_VERIFIED', {
                code: 'EMAIL_NOT_VERIFIED',
              }),
            },
          }),
        ]
      : []),
    notFound(side, 'conversation'),
    ApiResponse({
      status: 409,
      description:
        'CHAT_SHOP_UNAVAILABLE = shop không còn được duyệt, hội thoại chỉ đọc (cả hai phía)',
      schema: {
        example: errorExample('This shop is not accepting new messages', {
          code: 'CHAT_SHOP_UNAVAILABLE',
        }),
      },
    }),
    ApiResponse({
      status: 429,
      description:
        'CHAT_RATE_LIMITED = gửi quá nhanh (tối đa 20 tin / 30 giây trên mọi hội thoại của người gửi); CHAT_AWAITING_REPLY = (chỉ người mua) đã gửi 10 tin liên tiếp mà shop chưa trả lời, tự mở lại khi shop trả lời',
      schema: {
        example: errorExample(
          'Please wait for the shop to reply before sending more messages',
          { code: 'CHAT_AWAITING_REPLY' },
        ),
      },
    }),
  );
}

export function ApiMarkRead(side: ChatSide) {
  return applyDecorators(
    ApiParam(CONVERSATION_ID_PARAM),
    ApiOperation({
      summary: `Đánh dấu ${actorName(side)} đã đọc tới tin mới nhất. Mốc chỉ tăng, gọi lại an toàn (idempotent); chỉ khi mốc thật sự nhích lên thì đối phương mới nhận \`chat:read\`. Cho phép cả khi shop bị khoá`,
    }),
    ApiResponse({
      status: 200,
      schema: {
        example: {
          success: true,
          data: { readAt: '2026-10-01T10:05:00.000Z' },
        },
      },
    }),
    notFound(side, 'conversation'),
  );
}
