import { errorExample } from '../../shared/swagger/error-examples';

// Ví dụ body lỗi dùng chung cho Swagger của BuyerOrderController và SellerOrderController. Đơn không
// tồn tại / thuộc người khác / (với Seller) chưa thanh toán đều trả CÙNG 1 body này — không phân biệt,
// để không lộ id nào có thật.
export const ORDER_NOT_FOUND_EXAMPLE = errorExample('Order not found', {
  code: 'ORDER_NOT_FOUND',
});

// Dòng hàng ở DANH SÁCH đơn của người mua (snapshot lúc đặt).
export const ORDER_ITEM_EXAMPLE = {
  productName: 'Áo thun cotton',
  variantLabel: 'Đỏ / M',
  sku: 'SKU-AO-DO-M',
  imageUrl: 'https://res.cloudinary.com/demo/image/upload/ao-thun.jpg',
  quantity: 2,
  priceAtPurchase: '150000',
};

// Dòng hàng ở CHI TIẾT đơn: thêm định danh sản phẩm (dựng link) và trạng thái đánh giá của chính người mua
// (Week9.md 1.8). `review` là null khi chưa đánh giá; đã đánh giá thì
// { id, rating, comment, editedAt, canEdit }.
export const ORDER_DETAIL_ITEM_EXAMPLE = {
  ...ORDER_ITEM_EXAMPLE,
  productId: 'e1b2c3d4-1234-4a5b-8c9d-abcdef000005',
  productSlug: 'ao-thun-cotton',
  canReview: false,
  review: null,
};

export const ORDER_LIST_ITEM_EXAMPLE = {
  id: 'b1b2c3d4-1234-4a5b-8c9d-abcdef000002',
  checkoutGroupId: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
  status: 'AWAITING_PAYMENT',
  createdAt: '2026-10-01T10:00:00.000Z',
  totalAmount: '320000',
  shop: {
    id: 'c1b2c3d4-1234-4a5b-8c9d-abcdef000003',
    name: 'Shop Áo Xinh',
    slug: 'shop-ao-xinh',
    logoUrl: null,
  },
  items: [ORDER_ITEM_EXAMPLE],
  itemCount: 1,
  paymentMethod: 'VNPAY',
  paymentStatus: 'PENDING',
  canCancel: true,
  canRequestCancel: false,
  canRequestReturn: false,
  canConfirmReceived: false,
  canRetryPayment: true,
  refundRequest: null,
  refund: null,
};

export const ORDER_DETAIL_EXAMPLE = {
  ...ORDER_LIST_ITEM_EXAMPLE,
  items: [ORDER_DETAIL_ITEM_EXAMPLE],
  recipientName: 'Nguyễn Văn A',
  recipientPhone: '0912345678',
  shippingAddressLine: '12 Nguyễn Huệ',
  shippingWard: 'Phường Bến Nghé',
  shippingProvince: 'Hồ Chí Minh',
  subtotal: '300000',
  discountAmount: '0',
  shippingFee: '20000',
  carrier: null,
  trackingCode: null,
  buyerNote: 'Giao giờ hành chính, gọi trước khi giao nhé',
  history: [
    {
      fromStatus: null,
      toStatus: 'AWAITING_PAYMENT',
      actorType: 'BUYER',
      note: null,
      createdAt: '2026-10-01T10:00:00.000Z',
    },
  ],
};

// Đơn shop đã xác nhận (CONFIRMED) và đã thanh toán — trạng thái điển hình khi người mua có một yêu cầu hủy.
export const CONFIRMED_ORDER_DETAIL_EXAMPLE = {
  ...ORDER_DETAIL_EXAMPLE,
  status: 'CONFIRMED',
  paymentStatus: 'SUCCESS',
  canCancel: false,
  canRetryPayment: false,
};

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
