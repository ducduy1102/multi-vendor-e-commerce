import { describe, expect, it } from 'vitest';

import { getBlockedFulfilmentStep } from './order-fulfilment-hint';
import type { SellerOrderListItem } from './types';

type Order = Pick<SellerOrderListItem, 'status' | 'canPack' | 'canShip' | 'refundRequest'>;
type Summary = NonNullable<SellerOrderListItem['refundRequest']>;

const request = (status: Summary['status'], kind: Summary['kind'] = 'CANCEL'): Summary => ({
  id: 'request-1',
  kind,
  status,
  sellerRespondBy: '2026-10-03T03:00:00.000Z',
});

const order = (overrides: Partial<Order>): Order => ({
  status: 'CONFIRMED',
  canPack: false,
  canShip: false,
  refundRequest: null,
  ...overrides,
});

describe('getBlockedFulfilmentStep', () => {
  it('đơn đã xác nhận + yêu cầu hủy chờ shop -> bước bị khoá là đóng gói', () => {
    expect(
      getBlockedFulfilmentStep(
        order({ status: 'CONFIRMED', refundRequest: request('PENDING_SELLER') }),
      ),
    ).toBe('pack');
  });

  it('đơn đã đóng gói + yêu cầu hủy chờ shop -> bước bị khoá là giao hàng', () => {
    expect(
      getBlockedFulfilmentStep(
        order({ status: 'PACKED', refundRequest: request('PENDING_SELLER') }),
      ),
    ).toBe('ship');
  });

  it('yêu cầu hủy đã lên sàn (ESCALATED) vẫn chặn — hàng đang bị xin hủy', () => {
    expect(
      getBlockedFulfilmentStep(order({ status: 'CONFIRMED', refundRequest: request('ESCALATED') })),
    ).toBe('pack');
    expect(
      getBlockedFulfilmentStep(order({ status: 'PACKED', refundRequest: request('ESCALATED') })),
    ).toBe('ship');
  });

  it.each(['APPROVED', 'REJECTED_BY_SELLER', 'REJECTED', 'WITHDRAWN'] as const)(
    'yêu cầu hủy ở trạng thái %s không còn chặn',
    (status) => {
      expect(getBlockedFulfilmentStep(order({ refundRequest: request(status) }))).toBeNull();
    },
  );

  it('yêu cầu TRẢ HÀNG không bao giờ chặn đóng gói/giao (đơn đã giao rồi)', () => {
    expect(
      getBlockedFulfilmentStep(order({ refundRequest: request('PENDING_SELLER', 'RETURN') })),
    ).toBeNull();
    expect(
      getBlockedFulfilmentStep(
        order({ status: 'PACKED', refundRequest: request('ESCALATED', 'RETURN') }),
      ),
    ).toBeNull();
  });

  it('không có yêu cầu -> null', () => {
    expect(getBlockedFulfilmentStep(order({ refundRequest: null }))).toBeNull();
  });

  it('BE vẫn bật cờ của bước đó -> null (FE không nói "khoá" khi BE cho phép)', () => {
    expect(
      getBlockedFulfilmentStep(
        order({ status: 'CONFIRMED', canPack: true, refundRequest: request('PENDING_SELLER') }),
      ),
    ).toBeNull();
    expect(
      getBlockedFulfilmentStep(
        order({ status: 'PACKED', canShip: true, refundRequest: request('PENDING_SELLER') }),
      ),
    ).toBeNull();
  });

  it.each(['PENDING', 'SHIPPING', 'COMPLETED', 'CANCELLED', 'REFUNDED'] as const)(
    'đơn ở trạng thái %s không có bước đóng gói/giao kế tiếp -> null dù có yêu cầu hủy',
    (status) => {
      expect(
        getBlockedFulfilmentStep(order({ status, refundRequest: request('PENDING_SELLER') })),
      ).toBeNull();
    },
  );
});
