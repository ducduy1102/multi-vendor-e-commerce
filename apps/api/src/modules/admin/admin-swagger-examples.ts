// Ví dụ response Swagger cho khu Admin xử lý tiền hoàn (Week9.md 2.9). Chỉ là annotation — khớp
// adminRefundRequestSchema / adminRefundSchema / adminRefundablePaymentSchema ở packages/types.

export const ADMIN_REFUND_REQUEST_EXAMPLE = {
  id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
  kind: 'RETURN',
  status: 'ESCALATED',
  reasonCode: 'DAMAGED',
  reasonNote: 'Vỡ góc hộp, sản phẩm bị móp',
  sellerRespondBy: '2026-10-10T10:00:00.000Z',
  statusChangedAt: '2026-10-11T08:00:00.000Z',
  createdAt: '2026-10-08T10:00:00.000Z',
  history: [
    {
      toStatus: 'PENDING_SELLER',
      actorType: 'BUYER',
      note: null,
      createdAt: '2026-10-08T10:00:00.000Z',
    },
    {
      toStatus: 'REJECTED_BY_SELLER',
      actorType: 'SELLER',
      note: 'Hàng đã kiểm tra trước khi giao, không có lỗi',
      createdAt: '2026-10-09T09:00:00.000Z',
    },
    {
      toStatus: 'ESCALATED',
      actorType: 'BUYER',
      note: null,
      createdAt: '2026-10-11T08:00:00.000Z',
    },
  ],
  canApprove: true,
  canReject: true,
  shop: {
    id: 'b3f1c2e0-1234-4a5b-8c9d-abcdef123456',
    name: 'Shop Thời Trang ABC',
  },
  buyer: { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' },
  order: {
    id: 'b1b2c3d4-1234-4a5b-8c9d-abcdef000002',
    status: 'COMPLETED',
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
    refund: null,
  },
};

export const ADMIN_REFUND_EXAMPLE = {
  id: 'c1d2e3f4-1234-4a5b-8c9d-abcdef000003',
  status: 'FAILED',
  amount: '320000',
  attempts: 3,
  reason: 'Đồng ý trả hàng',
  failureReason:
    'Automatic retries exhausted: the payment gateway never confirmed this refund',
  gatewayRef: null,
  initiatedByType: 'ADMIN',
  createdAt: '2026-10-11T09:00:00.000Z',
  updatedAt: '2026-10-11T10:00:00.000Z',
  completedAt: null,
  canRetry: true,
  canMarkCompleted: true,
  payment: {
    id: 'd1e2f3a4-1234-4a5b-8c9d-abcdef000004',
    method: 'VNPAY',
    status: 'SUCCESS',
    amount: '320000',
    refundedAmount: '0',
    txnRef: 'ORDER17123456789ABCDE',
    transactionId: '14012345',
  },
  order: {
    id: 'b1b2c3d4-1234-4a5b-8c9d-abcdef000002',
    status: 'REFUNDED',
    totalAmount: '320000',
    recipientName: 'Nguyễn Văn A',
  },
  buyer: { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' },
};

export const ADMIN_REFUNDABLE_PAYMENT_EXAMPLE = {
  id: 'd1e2f3a4-1234-4a5b-8c9d-abcdef000005',
  kind: 'PAID_AFTER_EXPIRY',
  method: 'VNPAY',
  amount: '320000',
  paidAt: '2026-10-09T10:30:00.000Z',
  txnRef: 'ORDER17123456789FGHIJ',
  transactionId: '14012399',
  checkoutGroupId: 'e1f2a3b4-1234-4a5b-8c9d-abcdef000006',
  buyer: { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' },
  orders: [
    {
      id: 'b1b2c3d4-1234-4a5b-8c9d-abcdef000007',
      status: 'CANCELLED',
      totalAmount: '320000',
    },
  ],
};

export const REFUND_REQUEST_ID_PARAM = {
  name: 'id',
  description: 'ID yêu cầu',
};
export const REFUND_ID_PARAM = {
  name: 'id',
  description: 'ID khoản hoàn tiền',
};
export const PAYMENT_ID_PARAM = { name: 'id', description: 'ID thanh toán' };
