import {
  checkoutGroupStatusSchema,
  ORDER_STATUSES_VISIBLE_TO_SELLER,
  orderStatusSchema,
} from '@ecommerce/types';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { paymentMethodSchema, paymentStatusSchema } from '@ecommerce/types';

// Enum Zod dùng chung phải khớp enum Prisma — lệch nhau là lỗi im lặng (FE parse hỏng khi BE
// thêm 1 trạng thái mới).
describe('enum dùng chung khớp Prisma', () => {
  it('OrderStatus', () => {
    expect([...orderStatusSchema.options].sort()).toEqual(
      Object.values(OrderStatus).sort(),
    );
  });

  it('PaymentStatus', () => {
    expect([...paymentStatusSchema.options].sort()).toEqual(
      Object.values(PaymentStatus).sort(),
    );
  });

  it('PaymentMethod', () => {
    expect([...paymentMethodSchema.options].sort()).toEqual(
      Object.values(PaymentMethod).sort(),
    );
  });
});

describe('ORDER_STATUSES_VISIBLE_TO_SELLER', () => {
  it('KHÔNG chứa AWAITING_PAYMENT (đơn chưa trả tiền không được lộ cho Seller)', () => {
    expect(ORDER_STATUSES_VISIBLE_TO_SELLER).not.toContain('AWAITING_PAYMENT');
  });

  it('chứa mọi trạng thái còn lại (đơn đã thanh toán trở đi)', () => {
    expect(ORDER_STATUSES_VISIBLE_TO_SELLER).toHaveLength(
      orderStatusSchema.options.length - 1,
    );
    for (const status of [
      'PENDING',
      'CONFIRMED',
      'PACKED',
      'SHIPPING',
      'COMPLETED',
      'CANCELLED',
      'REFUNDED',
    ]) {
      expect(ORDER_STATUSES_VISIBLE_TO_SELLER).toContain(status);
    }
  });
});

describe('checkoutGroupStatusSchema', () => {
  it('đúng 7 trạng thái suy ra của nhóm thanh toán', () => {
    expect([...checkoutGroupStatusSchema.options].sort()).toEqual(
      [
        'AWAITING_PAYMENT',
        'CANCELLED',
        'PAID',
        'PAID_AFTER_EXPIRY',
        'PAYMENT_EXPIRED',
        'PAYMENT_FAILED',
        'COD_PLACED',
      ].sort(),
    );
  });
});
