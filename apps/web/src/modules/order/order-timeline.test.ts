import { orderActorTypeSchema, orderStatusSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import { describeTimelineEntry, sortTimelineNewestFirst } from './order-timeline';
import type { OrderHistoryEntry } from './types';

const entry = (overrides: Partial<OrderHistoryEntry>): OrderHistoryEntry => ({
  fromStatus: 'PENDING',
  toStatus: 'CONFIRMED',
  actorType: 'SELLER',
  note: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

describe('describeTimelineEntry — nhãn theo cặp trạng thái', () => {
  it('mốc tạo đơn online (null → AWAITING_PAYMENT) = đã đặt, chờ thanh toán', () => {
    expect(
      describeTimelineEntry(
        entry({ fromStatus: null, toStatus: 'AWAITING_PAYMENT', actorType: 'BUYER' }),
      ).labelKey,
    ).toBe('timelineCreatedAwaitingPayment');
  });

  it('mốc tạo đơn COD (null → PENDING) = đã đặt, chờ shop xác nhận', () => {
    expect(
      describeTimelineEntry(entry({ fromStatus: null, toStatus: 'PENDING', actorType: 'BUYER' }))
        .labelKey,
    ).toBe('timelineCreatedPending');
  });

  it('AWAITING_PAYMENT → PENDING = đã thanh toán (khác với mốc tạo đơn COD)', () => {
    expect(
      describeTimelineEntry(
        entry({ fromStatus: 'AWAITING_PAYMENT', toStatus: 'PENDING', actorType: 'SYSTEM' }),
      ).labelKey,
    ).toBe('timelinePaid');
  });

  it.each([
    ['CONFIRMED', 'timelineConfirmed'],
    ['PACKED', 'timelinePacked'],
    ['SHIPPING', 'timelineShipping'],
    ['REFUNDED', 'timelineRefunded'],
  ] as const)('→ %s dùng nhãn %s', (toStatus, labelKey) => {
    expect(describeTimelineEntry(entry({ toStatus })).labelKey).toBe(labelKey);
  });

  it('hoàn tất do người mua bấm vs do hệ thống tự hoàn tất sau N ngày', () => {
    expect(
      describeTimelineEntry(entry({ toStatus: 'COMPLETED', actorType: 'BUYER' })).labelKey,
    ).toBe('timelineCompleted');
    expect(
      describeTimelineEntry(entry({ toStatus: 'COMPLETED', actorType: 'SYSTEM' })).labelKey,
    ).toBe('timelineCompletedAuto');
  });

  it('hủy: phân biệt người mua tự hủy / shop từ chối / hệ thống (hết hạn thanh toán)', () => {
    const cancelled = (actorType: OrderHistoryEntry['actorType']) =>
      describeTimelineEntry(entry({ toStatus: 'CANCELLED', actorType })).labelKey;

    expect(cancelled('BUYER')).toBe('timelineCancelledByBuyer');
    expect(cancelled('SELLER')).toBe('timelineCancelledBySeller');
    expect(cancelled('SYSTEM')).toBe('timelineCancelledBySystem');
    expect(cancelled('ADMIN')).toBe('timelineCancelled');
  });

  it('mọi cặp (trạng thái đích × người thực hiện) đều ra nhãn có bản dịch ở cả vi lẫn en', () => {
    const viOrder = vi.order as Record<string, string>;
    const enOrder = en.order as Record<string, string>;

    for (const toStatus of orderStatusSchema.options) {
      for (const actorType of orderActorTypeSchema.options) {
        for (const fromStatus of [null, ...orderStatusSchema.options]) {
          for (const viewer of ['buyer', 'seller'] as const) {
            const { labelKey } = describeTimelineEntry(
              entry({ fromStatus, toStatus, actorType }),
              viewer,
            );
            expect(viOrder[labelKey], `vi ${labelKey}`).toBeTruthy();
            expect(enOrder[labelKey], `en ${labelKey}`).toBeTruthy();
          }
        }
      }
    }
  });
});

describe('describeTimelineEntry — góc nhìn của người đọc', () => {
  const cancelled = (actorType: OrderHistoryEntry['actorType'], viewer?: 'buyer' | 'seller') =>
    describeTimelineEntry(entry({ toStatus: 'CANCELLED', actorType }), viewer).labelKey;

  it('người MUA hủy: người mua đọc "Bạn đã hủy", shop đọc "Người mua đã hủy"', () => {
    expect(cancelled('BUYER')).toBe('timelineCancelledByBuyer');
    expect(cancelled('BUYER', 'buyer')).toBe('timelineCancelledByBuyer');
    expect(cancelled('BUYER', 'seller')).toBe('timelineBuyerCancelled');
  });

  it('các loại hủy khác không phụ thuộc người đọc', () => {
    for (const viewer of ['buyer', 'seller'] as const) {
      expect(cancelled('SELLER', viewer)).toBe('timelineCancelledBySeller');
      expect(cancelled('SYSTEM', viewer)).toBe('timelineCancelledBySystem');
      expect(cancelled('ADMIN', viewer)).toBe('timelineCancelled');
    }
  });

  it('mọi bước không phải "người mua hủy" có cùng nhãn cho cả hai người đọc', () => {
    for (const toStatus of orderStatusSchema.options) {
      for (const actorType of orderActorTypeSchema.options) {
        if (toStatus === 'CANCELLED' && actorType === 'BUYER') continue;
        const e = entry({ toStatus, actorType });
        // Chỉ so nhãn bước và việc có hiện note không; câu bọc lý do (noteKey) khác nhau theo người đọc ở
        // test riêng bên dưới và chỉ có nghĩa khi có note.
        const { labelKey: sellerLabel, showNote: sellerShow } = describeTimelineEntry(e, 'seller');
        const { labelKey: buyerLabel, showNote: buyerShow } = describeTimelineEntry(e, 'buyer');
        expect({ labelKey: sellerLabel, showNote: sellerShow }).toEqual({
          labelKey: buyerLabel,
          showNote: buyerShow,
        });
      }
    }
  });

  it('quy tắc hiện note giống nhau ở cả hai góc nhìn (chỉ khác câu bọc): shop từ chối / người mua hủy CÓ lý do', () => {
    const sellerRejects = entry({ toStatus: 'CANCELLED', actorType: 'SELLER', note: 'Hết hàng' });
    const buyerCancels = entry({ toStatus: 'CANCELLED', actorType: 'BUYER', note: 'Đặt nhầm' });
    const buyerCancelsNoReason = entry({ toStatus: 'CANCELLED', actorType: 'BUYER', note: null });
    for (const viewer of ['buyer', 'seller'] as const) {
      expect(describeTimelineEntry(sellerRejects, viewer).showNote).toBe(true);
      expect(describeTimelineEntry(buyerCancels, viewer).showNote).toBe(true);
      expect(describeTimelineEntry(buyerCancelsNoReason, viewer).showNote).toBe(false);
    }
  });
});

describe('describeTimelineEntry — câu bọc lý do theo người viết và người đọc (noteKey)', () => {
  it('lý do của shop: cùng một câu cho cả người mua lẫn shop đọc', () => {
    const e = entry({ toStatus: 'CANCELLED', actorType: 'SELLER', note: 'Hết hàng' });
    expect(describeTimelineEntry(e, 'buyer').noteKey).toBe('timelineReason');
    expect(describeTimelineEntry(e, 'seller').noteKey).toBe('timelineReason');
  });

  it('lý do của người mua: shop đọc là "của người mua", chính người mua đọc là "của bạn"', () => {
    const e = entry({ toStatus: 'CANCELLED', actorType: 'BUYER', note: 'Đặt nhầm' });
    expect(describeTimelineEntry(e, 'seller').noteKey).toBe('timelineBuyerReason');
    expect(describeTimelineEntry(e, 'buyer').noteKey).toBe('timelineYourReason');
  });

  it('không truyền viewer ⇒ góc nhìn người mua', () => {
    const e = entry({ toStatus: 'CANCELLED', actorType: 'BUYER', note: 'Đặt nhầm' });
    expect(describeTimelineEntry(e).noteKey).toBe('timelineYourReason');
  });
});

describe('describeTimelineEntry — chỉ hiện note khi đơn bị HỦY bởi một người (shop hoặc người mua)', () => {
  it('shop từ chối kèm lý do -> hiện note', () => {
    expect(
      describeTimelineEntry(entry({ toStatus: 'CANCELLED', actorType: 'SELLER', note: 'Hết hàng' }))
        .showNote,
    ).toBe(true);
  });

  it('shop từ chối nhưng note rỗng/null -> không hiện (không có gì để hiện)', () => {
    expect(
      describeTimelineEntry(entry({ toStatus: 'CANCELLED', actorType: 'SELLER', note: null }))
        .showNote,
    ).toBe(false);
    expect(
      describeTimelineEntry(entry({ toStatus: 'CANCELLED', actorType: 'SELLER', note: '' }))
        .showNote,
    ).toBe(false);
  });

  it('người mua hủy KÈM lý do -> hiện note (shop biết vì sao khách hủy)', () => {
    expect(
      describeTimelineEntry(entry({ toStatus: 'CANCELLED', actorType: 'BUYER', note: 'Đặt nhầm' }))
        .showNote,
    ).toBe(true);
  });

  it('người mua hủy KHÔNG nhập lý do (BE ghi null) hoặc note rỗng -> không hiện gì', () => {
    for (const note of [null, '']) {
      expect(
        describeTimelineEntry(entry({ toStatus: 'CANCELLED', actorType: 'BUYER', note })).showNote,
      ).toBe(false);
    }
  });

  it('note của người mua/shop ở bước KHÔNG phải hủy (đặt hàng, xác nhận, giao…) không hiện', () => {
    for (const toStatus of orderStatusSchema.options) {
      if (toStatus === 'CANCELLED') continue;
      for (const actorType of ['BUYER', 'SELLER'] as const) {
        expect(
          describeTimelineEntry(entry({ toStatus, actorType, note: 'ghi chú' })).showNote,
        ).toBe(false);
      }
    }
  });

  it('ghi chú hệ thống ("Payment hold reclaimed", "Payment confirmed", "backfill"...) không bao giờ hiện', () => {
    for (const note of [
      'Payment hold reclaimed',
      'Payment confirmed',
      'backfill',
      'Received by buyer',
    ]) {
      for (const toStatus of orderStatusSchema.options) {
        expect(describeTimelineEntry(entry({ toStatus, actorType: 'SYSTEM', note })).showNote).toBe(
          false,
        );
      }
    }
  });
});

describe('sortTimelineNewestFirst', () => {
  it('đảo cũ → mới thành mới → cũ và không sửa mảng gốc', () => {
    const history = [
      entry({ fromStatus: null, toStatus: 'PENDING', createdAt: '2026-10-01T01:00:00.000Z' }),
      entry({ toStatus: 'CONFIRMED', createdAt: '2026-10-01T02:00:00.000Z' }),
      entry({ fromStatus: 'CONFIRMED', toStatus: 'PACKED', createdAt: '2026-10-01T03:00:00.000Z' }),
    ];
    const snapshot = history.map((h) => h.toStatus);

    const sorted = sortTimelineNewestFirst(history);

    expect(sorted.map((h) => h.toStatus)).toEqual(['PACKED', 'CONFIRMED', 'PENDING']);
    expect(history.map((h) => h.toStatus)).toEqual(snapshot);
  });

  it('mảng rỗng -> rỗng', () => {
    expect(sortTimelineNewestFirst([])).toEqual([]);
  });
});
