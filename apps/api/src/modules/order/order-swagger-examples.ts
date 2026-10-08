import { errorExample } from '../../shared/swagger/error-examples';

// Ví dụ body lỗi dùng chung cho Swagger của BuyerOrderController và SellerOrderController. Đơn không
// tồn tại / thuộc người khác / (với Seller) chưa thanh toán đều trả CÙNG 1 body này — không phân biệt,
// để không lộ id nào có thật.
export const ORDER_NOT_FOUND_EXAMPLE = errorExample('Order not found', {
  code: 'ORDER_NOT_FOUND',
});

// Yêu cầu hủy/trả hàng của người mua trong chi tiết đơn (`refundRequest`): `history` KHÔNG có actorId, các cờ
// canWithdraw/canEscalate do BE tính.
export const REFUND_REQUEST_EXAMPLE = {
  id: 'd1b2c3d4-1234-4a5b-8c9d-abcdef000004',
  kind: 'CANCEL',
  status: 'PENDING_SELLER',
  reasonCode: 'CHANGE_OF_MIND',
  reasonNote: 'Đổi ý, không cần nữa',
  sellerRespondBy: '2026-10-10T10:00:00.000Z',
  statusChangedAt: '2026-10-08T10:00:00.000Z',
  createdAt: '2026-10-08T10:00:00.000Z',
  history: [
    {
      toStatus: 'PENDING_SELLER',
      actorType: 'BUYER',
      note: null,
      createdAt: '2026-10-08T10:00:00.000Z',
    },
  ],
  canWithdraw: true,
  canEscalate: false,
};
