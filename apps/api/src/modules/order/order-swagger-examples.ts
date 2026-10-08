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

// shopId lấy qua @ShopOwnerContext() (do ShopOwnerGuard resolve sẵn) chứ không qua @Param('shopId') nên
// Swagger không tự suy ra tham số đường dẫn này — phải khai tay (cùng lý do VoucherController).
export const SHOP_ID_PARAM = {
  name: 'shopId',
  description: 'Id của shop mình sở hữu',
  example: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
};

// Tóm tắt yêu cầu ở danh sách đơn của seller (`refundRequest` của sellerOrderListItemSchema).
export const SELLER_REFUND_REQUEST_SUMMARY_EXAMPLE = {
  id: 'd1b2c3d4-1234-4a5b-8c9d-abcdef000004',
  kind: 'CANCEL',
  status: 'PENDING_SELLER',
  sellerRespondBy: '2026-10-10T10:00:00.000Z',
};

// Một dòng của hàng chờ yêu cầu phía seller: yêu cầu đầy đủ (lý do người mua, timeline không định danh, cờ
// canApprove/canReject) + tóm tắt đơn.
export const SELLER_REFUND_REQUEST_LIST_ITEM_EXAMPLE = {
  ...SELLER_REFUND_REQUEST_SUMMARY_EXAMPLE,
  reasonCode: 'CHANGE_OF_MIND',
  reasonNote: 'Đổi ý, không cần nữa',
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
  canApprove: true,
  canReject: true,
  order: {
    id: 'b1b2c3d4-1234-4a5b-8c9d-abcdef000002',
    status: 'CONFIRMED',
    totalAmount: '320000',
    recipientName: 'Nguyễn Văn A',
    items: [
      {
        productName: 'Áo thun cotton',
        variantLabel: 'Đỏ / M',
        sku: 'SKU-AO-DO-M',
        imageUrl: null,
        quantity: 2,
        priceAtPurchase: '150000',
      },
    ],
    itemCount: 1,
    paymentMethod: 'VNPAY',
    paymentStatus: 'SUCCESS',
  },
};
