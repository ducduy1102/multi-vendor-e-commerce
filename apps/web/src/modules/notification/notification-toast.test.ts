import { NOTIFICATION_TYPES } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import { shouldToastNotification } from './notification-toast';
import {
  ORDER_ID,
  PRODUCT_ID,
  SHOP_ID,
  at,
  makeUnknownNotification,
  uuid,
} from './notification-test-data';
import type { Notification } from './types';

const BASE = { id: uuid(1), readAt: null, createdAt: at(0) };

// Mỗi loại một mẫu + quyết định mong đợi. Bảng phủ MỌI loại (kiểm ở test cuối) nên thêm loại mới mà không quyết định có
// toast hay không thì đỏ.
const CASES: { name: string; notification: Notification; toast: boolean }[] = [
  {
    name: 'ORDER_NEW',
    notification: { ...BASE, type: 'ORDER_NEW', data: { orderId: ORDER_ID } },
    toast: true,
  },
  {
    name: 'ORDER_CONFIRMED',
    notification: { ...BASE, type: 'ORDER_CONFIRMED', data: { orderId: ORDER_ID, shopName: 's' } },
    toast: false,
  },
  {
    name: 'ORDER_SHIPPED',
    notification: { ...BASE, type: 'ORDER_SHIPPED', data: { orderId: ORDER_ID, shopName: 's' } },
    toast: false,
  },
  {
    name: 'ORDER_COMPLETED',
    notification: { ...BASE, type: 'ORDER_COMPLETED', data: { orderId: ORDER_ID, shopName: 's' } },
    toast: false,
  },
  {
    name: 'ORDER_CANCELLED người mua bị shop hủy',
    notification: {
      ...BASE,
      type: 'ORDER_CANCELLED',
      data: { orderId: ORDER_ID, audience: 'BUYER', by: 'SELLER', shopName: 's' },
    },
    toast: true,
  },
  {
    name: 'ORDER_CANCELLED chủ shop bị người mua hủy',
    notification: {
      ...BASE,
      type: 'ORDER_CANCELLED',
      data: { orderId: ORDER_ID, audience: 'SELLER', by: 'BUYER', shopName: 's' },
    },
    toast: true,
  },
  {
    name: 'ORDER_CANCELLED người mua TỰ hủy (bản ghi việc vừa làm)',
    notification: {
      ...BASE,
      type: 'ORDER_CANCELLED',
      data: { orderId: ORDER_ID, audience: 'BUYER', by: 'BUYER', shopName: 's' },
    },
    toast: false,
  },
  {
    name: 'ORDER_CANCELLED chủ shop TỰ hủy',
    notification: {
      ...BASE,
      type: 'ORDER_CANCELLED',
      data: { orderId: ORDER_ID, audience: 'SELLER', by: 'SELLER', shopName: 's' },
    },
    toast: false,
  },
  {
    name: 'ORDER_CANCELLED hệ thống hủy',
    notification: {
      ...BASE,
      type: 'ORDER_CANCELLED',
      data: { orderId: ORDER_ID, audience: 'BUYER', by: 'SYSTEM', shopName: 's' },
    },
    toast: true,
  },
  {
    name: 'REFUND_REQUEST_NEW',
    notification: {
      ...BASE,
      type: 'REFUND_REQUEST_NEW',
      data: { orderId: ORDER_ID, kind: 'CANCEL' },
    },
    toast: true,
  },
  {
    name: 'REFUND_REQUEST_APPROVED',
    notification: {
      ...BASE,
      type: 'REFUND_REQUEST_APPROVED',
      data: { orderId: ORDER_ID, kind: 'CANCEL' },
    },
    toast: true,
  },
  {
    name: 'REFUND_REQUEST_REJECTED',
    notification: {
      ...BASE,
      type: 'REFUND_REQUEST_REJECTED',
      data: { orderId: ORDER_ID, kind: 'RETURN' },
    },
    toast: true,
  },
  {
    name: 'REFUND_REQUEST_ESCALATED',
    notification: {
      ...BASE,
      type: 'REFUND_REQUEST_ESCALATED',
      data: { orderId: ORDER_ID, kind: 'RETURN', audience: 'ADMIN' },
    },
    toast: true,
  },
  {
    name: 'REFUND_REQUEST_DECIDED_BY_ADMIN',
    notification: {
      ...BASE,
      type: 'REFUND_REQUEST_DECIDED_BY_ADMIN',
      data: { orderId: ORDER_ID, kind: 'RETURN', outcome: 'APPROVED' },
    },
    toast: true,
  },
  {
    name: 'REFUND_COMPLETED',
    notification: { ...BASE, type: 'REFUND_COMPLETED', data: { orderId: ORDER_ID } },
    toast: true,
  },
  {
    name: 'REVIEW_NEW',
    notification: {
      ...BASE,
      type: 'REVIEW_NEW',
      data: { productId: PRODUCT_ID, productName: 'p', rating: 5 },
    },
    toast: false,
  },
  {
    name: 'REVIEW_REPLIED',
    notification: {
      ...BASE,
      type: 'REVIEW_REPLIED',
      data: { productId: PRODUCT_ID, productName: 'p', shopName: 's' },
    },
    toast: false,
  },
  {
    name: 'SHOP_STATUS_CHANGED',
    notification: {
      ...BASE,
      type: 'SHOP_STATUS_CHANGED',
      data: { shopId: SHOP_ID, status: 'APPROVED' },
    },
    toast: true,
  },
  {
    name: 'ADMIN_SHOP_PENDING',
    notification: { ...BASE, type: 'ADMIN_SHOP_PENDING', data: { shopId: SHOP_ID, shopName: 's' } },
    toast: true,
  },
  {
    name: 'ADMIN_APPEAL_PENDING',
    notification: {
      ...BASE,
      type: 'ADMIN_APPEAL_PENDING',
      data: { appealId: SHOP_ID, shopId: SHOP_ID, shopName: 's' },
    },
    toast: true,
  },
  {
    name: 'APPEAL_DECIDED',
    notification: {
      ...BASE,
      type: 'APPEAL_DECIDED',
      data: { appealId: SHOP_ID, shopId: SHOP_ID, decision: 'REJECTED' },
    },
    toast: true,
  },
  {
    name: 'REPORT_NEW',
    notification: {
      ...BASE,
      type: 'REPORT_NEW',
      data: { reportId: SHOP_ID, targetType: 'SHOP' },
    },
    toast: true,
  },
  {
    name: 'REPORT_RESOLVED',
    notification: {
      ...BASE,
      type: 'REPORT_RESOLVED',
      data: { reportId: SHOP_ID, targetType: 'SHOP', outcome: 'RESOLVED' },
    },
    toast: true,
  },
  {
    name: 'REVIEW_HIDDEN',
    notification: {
      ...BASE,
      type: 'REVIEW_HIDDEN',
      data: { orderId: SHOP_ID, productName: 'Áo thun' },
    },
    toast: true,
  },
  {
    name: 'PRODUCT_TAKEN_DOWN',
    notification: {
      ...BASE,
      type: 'PRODUCT_TAKEN_DOWN',
      data: { productId: SHOP_ID, productName: 'Dao bấm', reason: 'Hàng cấm' },
    },
    toast: true,
  },
  { name: 'UNKNOWN', notification: makeUnknownNotification(), toast: false },
];

describe('shouldToastNotification', () => {
  it.each(CASES)('$name ⇒ toast=$toast', ({ notification, toast }) => {
    expect(shouldToastNotification(notification)).toBe(toast);
  });

  it('bảng phủ MỌI loại thông báo của BE (và UNKNOWN) — thêm loại mới mà quên quyết định thì đỏ', () => {
    expect(new Set(CASES.map((c) => c.notification.type))).toEqual(
      new Set([...NOTIFICATION_TYPES, 'UNKNOWN']),
    );
  });

  it('không toast mọi thứ: loại tiến độ thường lệ và đánh giá bị loại', () => {
    const toasted = CASES.filter((c) => c.toast).length;

    expect(toasted).toBeGreaterThan(0);
    expect(toasted).toBeLessThan(CASES.length);
  });
});
