import { refundRequestStatusSchema } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import {
  describeRefundRequestEntry,
  sortRefundHistoryNewestFirst,
} from './refund-request-timeline';
import type { RefundRequestHistoryItem } from './types';

const entry = (
  toStatus: RefundRequestHistoryItem['toStatus'],
  actorType: RefundRequestHistoryItem['actorType'],
  note: string | null = null,
  createdAt = '2026-10-01T00:00:00.000Z',
): RefundRequestHistoryItem => ({ toStatus, actorType, note, createdAt });

describe('describeRefundRequestEntry — nhãn theo (trạng thái đích, người thực hiện)', () => {
  it.each([
    [entry('PENDING_SELLER', 'BUYER'), 'refundTimelineCreated'],
    [entry('APPROVED', 'SELLER'), 'refundTimelineApprovedBySeller'],
    [entry('APPROVED', 'ADMIN'), 'refundTimelineApprovedByAdmin'],
    [entry('APPROVED', 'SYSTEM'), 'refundTimelineApprovedBySystem'],
    [entry('REJECTED_BY_SELLER', 'SELLER'), 'refundTimelineRejectedBySeller'],
    [entry('ESCALATED', 'BUYER'), 'refundTimelineEscalatedByBuyer'],
    [entry('ESCALATED', 'SYSTEM'), 'refundTimelineEscalatedBySystem'],
    [entry('REJECTED', 'ADMIN'), 'refundTimelineRejectedByAdmin'],
    [entry('WITHDRAWN', 'BUYER'), 'refundTimelineWithdrawn'],
  ])('%j -> %s', (item, labelKey) => {
    expect(describeRefundRequestEntry(item).labelKey).toBe(labelKey);
  });

  it('cùng trạng thái đích nhưng người làm khác nhau cho nhãn khác nhau (duyệt bởi shop/sàn/hệ thống)', () => {
    const keys = (['SELLER', 'ADMIN', 'SYSTEM'] as const).map(
      (actor) => describeRefundRequestEntry(entry('APPROVED', actor)).labelKey,
    );

    expect(new Set(keys).size).toBe(3);
  });

  it('mọi nhãn trả về đều có bản dịch ở vi và en (kể cả khi ghép trạng thái × người làm bất kỳ)', () => {
    const actors = ['BUYER', 'SELLER', 'ADMIN', 'SYSTEM'] as const;
    for (const status of refundRequestStatusSchema.options) {
      for (const actor of actors) {
        const { labelKey, noteKey } = describeRefundRequestEntry(entry(status, actor, 'x'));
        for (const messages of [vi.order, en.order] as Record<string, string>[]) {
          expect(messages[labelKey], `${status}/${actor} → ${labelKey}`).toBeTruthy();
          expect(messages[noteKey], `${status}/${actor} → ${noteKey}`).toBeTruthy();
        }
      }
    }
  });
});

describe('describeRefundRequestEntry — ghi chú', () => {
  it('lý do của shop (từ chối/duyệt) hiện kèm câu "Lý do của shop"', () => {
    expect(
      describeRefundRequestEntry(entry('REJECTED_BY_SELLER', 'SELLER', 'Hàng đã gửi')),
    ).toMatchObject({ showNote: true, noteKey: 'timelineReason' });
  });

  it('lý do của sàn hiện kèm câu riêng "Lý do của sàn"', () => {
    expect(
      describeRefundRequestEntry(entry('REJECTED', 'ADMIN', 'Thiếu bằng chứng')),
    ).toMatchObject({
      showNote: true,
      noteKey: 'refundNoteAdmin',
    });
  });

  it('ghi chú rỗng/null không hiện, dù do shop hay sàn nhập', () => {
    expect(describeRefundRequestEntry(entry('APPROVED', 'SELLER', null)).showNote).toBe(false);
    expect(describeRefundRequestEntry(entry('APPROVED', 'ADMIN', '')).showNote).toBe(false);
  });

  it('note của HỆ THỐNG và của người mua KHÔNG hiện (có thể là chuỗi tiếng Anh nội bộ, không dành cho người dùng)', () => {
    expect(
      describeRefundRequestEntry(entry('APPROVED', 'SYSTEM', 'Seller response deadline passed'))
        .showNote,
    ).toBe(false);
    expect(describeRefundRequestEntry(entry('PENDING_SELLER', 'BUYER', 'internal')).showNote).toBe(
      false,
    );
  });
});

describe('describeRefundRequestEntry — góc nhìn của shop (viewer "seller")', () => {
  it.each([
    [entry('PENDING_SELLER', 'BUYER'), 'refundSellerTimelineCreated'],
    [entry('APPROVED', 'SELLER'), 'refundSellerTimelineApprovedBySeller'],
    [entry('APPROVED', 'SYSTEM'), 'refundSellerTimelineApprovedBySystem'],
    [entry('REJECTED_BY_SELLER', 'SELLER'), 'refundSellerTimelineRejectedBySeller'],
    [entry('ESCALATED', 'BUYER'), 'refundSellerTimelineEscalatedByBuyer'],
    [entry('ESCALATED', 'SYSTEM'), 'refundSellerTimelineEscalatedBySystem'],
    [entry('WITHDRAWN', 'BUYER'), 'refundSellerTimelineWithdrawn'],
  ])(
    '%j -> %s (chủ ngữ là người mua hoặc "bạn", không phải "Bạn đã gửi" của người mua)',
    (item, labelKey) => {
      expect(describeRefundRequestEntry(item, 'seller').labelKey).toBe(labelKey);
    },
  );

  it('câu của sàn đúng với cả hai phía nên dùng chung key, không viết hai bản', () => {
    expect(describeRefundRequestEntry(entry('APPROVED', 'ADMIN'), 'seller').labelKey).toBe(
      describeRefundRequestEntry(entry('APPROVED', 'ADMIN'), 'buyer').labelKey,
    );
    expect(describeRefundRequestEntry(entry('REJECTED', 'ADMIN'), 'seller').labelKey).toBe(
      describeRefundRequestEntry(entry('REJECTED', 'ADMIN'), 'buyer').labelKey,
    );
  });

  it('mặc định (không truyền viewer) vẫn là góc nhìn người mua — không đổi hành vi cũ', () => {
    const item = entry('PENDING_SELLER', 'BUYER');

    expect(describeRefundRequestEntry(item)).toEqual(describeRefundRequestEntry(item, 'buyer'));
    expect(describeRefundRequestEntry(item).labelKey).toBe('refundTimelineCreated');
  });

  it('ghi chú của chính shop đọc là "Lý do của bạn", của sàn vẫn là "Lý do của sàn"', () => {
    expect(
      describeRefundRequestEntry(entry('REJECTED_BY_SELLER', 'SELLER', 'Hàng đã gửi'), 'seller'),
    ).toMatchObject({ showNote: true, noteKey: 'refundNoteSeller' });
    expect(
      describeRefundRequestEntry(entry('REJECTED', 'ADMIN', 'Thiếu bằng chứng'), 'seller'),
    ).toMatchObject({ showNote: true, noteKey: 'refundNoteAdmin' });
  });

  it('quy tắc hiện ghi chú không đổi theo góc nhìn: hệ thống và người mua không bao giờ hiện', () => {
    expect(
      describeRefundRequestEntry(entry('APPROVED', 'SYSTEM', 'internal'), 'seller').showNote,
    ).toBe(false);
    expect(
      describeRefundRequestEntry(entry('PENDING_SELLER', 'BUYER', 'internal'), 'seller').showNote,
    ).toBe(false);
  });

  it('mọi nhãn/câu ghi chú của góc nhìn shop đều có bản dịch ở vi và en (ghép trạng thái × người làm bất kỳ)', () => {
    const actors = ['BUYER', 'SELLER', 'ADMIN', 'SYSTEM'] as const;
    for (const status of refundRequestStatusSchema.options) {
      for (const actor of actors) {
        const { labelKey, noteKey } = describeRefundRequestEntry(
          entry(status, actor, 'x'),
          'seller',
        );
        for (const messages of [vi.order, en.order] as Record<string, string>[]) {
          expect(messages[labelKey], `${status}/${actor} → ${labelKey}`).toBeTruthy();
          expect(messages[noteKey], `${status}/${actor} → ${noteKey}`).toBeTruthy();
        }
      }
    }
  });

  it('câu của góc nhìn shop không trùng câu của người mua (tránh dùng nhầm "Bạn đã gửi yêu cầu" cho shop)', () => {
    const items = [
      entry('PENDING_SELLER', 'BUYER'),
      entry('APPROVED', 'SELLER'),
      entry('APPROVED', 'SYSTEM'),
      entry('REJECTED_BY_SELLER', 'SELLER'),
      entry('ESCALATED', 'BUYER'),
      entry('ESCALATED', 'SYSTEM'),
      entry('WITHDRAWN', 'BUYER'),
    ];
    for (const item of items) {
      const buyerKey = describeRefundRequestEntry(item, 'buyer').labelKey;
      const sellerKey = describeRefundRequestEntry(item, 'seller').labelKey;
      expect(sellerKey, `${item.toStatus}/${item.actorType}`).not.toBe(buyerKey);
      expect((vi.order as Record<string, string>)[sellerKey]).not.toBe(
        (vi.order as Record<string, string>)[buyerKey],
      );
    }
  });
});

describe('sortRefundHistoryNewestFirst', () => {
  it('đảo cũ → mới thành mới → cũ và không sửa mảng gốc', () => {
    const history = [
      entry('PENDING_SELLER', 'BUYER', null, '2026-10-01T00:00:00.000Z'),
      entry('REJECTED_BY_SELLER', 'SELLER', 'x', '2026-10-02T00:00:00.000Z'),
      entry('ESCALATED', 'BUYER', null, '2026-10-03T00:00:00.000Z'),
    ];
    const original = [...history];

    expect(sortRefundHistoryNewestFirst(history).map((h) => h.toStatus)).toEqual([
      'ESCALATED',
      'REJECTED_BY_SELLER',
      'PENDING_SELLER',
    ]);
    expect(history).toEqual(original);
  });

  it('mảng rỗng -> rỗng', () => {
    expect(sortRefundHistoryNewestFirst([])).toEqual([]);
  });
});
