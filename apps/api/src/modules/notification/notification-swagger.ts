import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import {
  NOTIFICATIONS_MAX_PAGE_SIZE,
  NOTIFICATIONS_PAGE_SIZE,
} from '@ecommerce/types';
import { errorExample } from '../../shared/swagger/error-examples';

// Tài liệu Swagger của controller thông báo (Week10.md 7.6). Gom thành decorator theo thao tác; status khai ở đây phải khớp
// status THỰC của route (notification.controller.int-spec.ts đối chiếu /docs-json với response thật).
const ORDER_ID = '2c6f6d3a-8d4b-4f55-9a52-0d9a2b6a7c11';
const NOTIFICATION_ID = 'f1b2c3d4-1234-4a5b-8c9d-abcdef000040';
const CURSOR =
  'MjAyNi0xMC0wMVQxMDowMDowMC4wMDBafGYxYjJjM2Q0LTEyMzQtNGE1Yi04YzlkLWFiY2RlZjAwMDA0MA';

const NOTIFICATION_EXAMPLE = {
  id: NOTIFICATION_ID,
  type: 'ORDER_CONFIRMED',
  data: { orderId: ORDER_ID, shopName: 'Shop Áo Xinh' },
  readAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
};

const NOT_FOUND_NOTE =
  'không tồn tại, của người khác hoặc id sai dạng — không phân biệt, để không lộ thông báo nào có thật';

export function ApiListNotifications() {
  return applyDecorators(
    ApiOperation({
      summary:
        'Một trang thông báo của chính người gọi, MỚI NHẤT trước. `unreadOnly=true` chỉ lấy thông báo chưa đọc. Loại lạ hoặc dữ liệu sai hình dạng được trả dưới dạng thông báo chung `type: "UNKNOWN"` với `data` rỗng',
    }),
    ApiQuery({
      name: 'cursor',
      required: false,
      description:
        'nextCursor của trang trước (chuỗi mờ, truyền lại nguyên trạng)',
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      description: `1..${NOTIFICATIONS_MAX_PAGE_SIZE}, mặc định ${NOTIFICATIONS_PAGE_SIZE}`,
    }),
    ApiQuery({
      name: 'unreadOnly',
      required: false,
      enum: ['true', 'false'],
      description: 'Chuỗi "true"/"false"; mặc định "false"',
    }),
    ApiResponse({
      status: 200,
      schema: {
        example: {
          success: true,
          data: { items: [NOTIFICATION_EXAMPLE], nextCursor: CURSOR },
        },
      },
    }),
    ApiResponse({
      status: 400,
      description:
        'Query sai (limit ngoài khoảng, unreadOnly lạ, con trỏ hỏng)',
      schema: { example: errorExample('Invalid cursor') },
    }),
  );
}

export function ApiNotificationUnreadCount() {
  return applyDecorators(
    ApiOperation({
      summary:
        'Số thông báo chưa đọc CHÍNH XÁC của người gọi (không trần) — cho huy hiệu ở Header',
    }),
    ApiResponse({
      status: 200,
      schema: { example: { success: true, data: { unreadCount: 3 } } },
    }),
  );
}

export function ApiMarkNotificationRead() {
  return applyDecorators(
    ApiParam({ name: 'id', description: 'ID thông báo của chính người gọi' }),
    ApiOperation({
      summary:
        'Đánh dấu MỘT thông báo là đã đọc. Idempotent và an toàn khi gọi đồng thời: mốc đọc chỉ được đặt một lần, gọi lại trả đúng mốc cũ',
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
    ApiResponse({
      status: 404,
      description: `Thông báo ${NOT_FOUND_NOTE}`,
      schema: { example: errorExample('Notification not found') },
    }),
  );
}

export function ApiMarkAllNotificationsRead() {
  return applyDecorators(
    ApiOperation({
      summary:
        'Đánh dấu TẤT CẢ thông báo chưa đọc của người gọi là đã đọc. Idempotent: khi không còn gì chưa đọc trả `updatedCount: 0`',
    }),
    ApiResponse({
      status: 200,
      schema: { example: { success: true, data: { updatedCount: 4 } } },
    }),
  );
}
