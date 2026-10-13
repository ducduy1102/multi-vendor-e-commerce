import {
  classifyAbnormalPayment,
  pickRefundablePayment,
  toRefundRef,
  type GroupPaymentLike,
} from './refund-payment-rules';

const at = (hour: number) =>
  new Date(`2026-10-07T${String(hour).padStart(2, '0')}:00:00.000Z`);

const pay = (
  id: string,
  overrides: Partial<GroupPaymentLike> = {},
): GroupPaymentLike => ({
  id,
  status: 'SUCCESS',
  method: 'VNPAY',
  paidAt: at(10),
  ...overrides,
});

describe('pickRefundablePayment', () => {
  it('nhóm không có khoản nào thu được ⇒ null', () => {
    expect(pickRefundablePayment([])).toBeNull();
    expect(
      pickRefundablePayment([
        pay('a', { status: 'FAILED' }),
        pay('b', { status: 'PENDING', paidAt: null }),
      ]),
    ).toBeNull();
  });

  it('chỉ nhận khoản SUCCESS, bỏ lần thử FAILED/PENDING', () => {
    expect(
      pickRefundablePayment([
        pay('a', { status: 'FAILED' }),
        pay('b'),
        pay('c', { status: 'PENDING', paidAt: null }),
      ])?.id,
    ).toBe('b');
  });

  it('khoản COD không bao giờ được chọn (không có cổng để hoàn)', () => {
    expect(pickRefundablePayment([pay('cod', { method: 'COD' })])).toBeNull();
  });

  it('có ≥ 2 khoản SUCCESS (thanh toán trùng) ⇒ chọn khoản có paidAt SỚM NHẤT', () => {
    expect(
      pickRefundablePayment([
        pay('late', { paidAt: at(12) }),
        pay('early', { paidAt: at(9) }),
        pay('mid', { paidAt: at(10) }),
      ])?.id,
    ).toBe('early');
  });

  it('hoà paidAt ⇒ theo id tăng dần (kết quả ổn định giữa các lần gọi)', () => {
    expect(
      pickRefundablePayment([
        pay('b', { paidAt: at(9) }),
        pay('a', { paidAt: at(9) }),
      ])?.id,
    ).toBe('a');
  });

  it('paidAt null xếp CUỐI', () => {
    expect(
      pickRefundablePayment([
        pay('nodate', { paidAt: null }),
        pay('dated', { paidAt: at(11) }),
      ])?.id,
    ).toBe('dated');
    expect(
      pickRefundablePayment([
        pay('b', { paidAt: null }),
        pay('a', { paidAt: null }),
      ])?.id,
    ).toBe('a');
  });
});

describe('classifyAbnormalPayment (Week9.md 1.9)', () => {
  it('PAID_AFTER_EXPIRY: khoản SUCCESS duy nhất mà mọi đơn đã CANCELLED', () => {
    expect(
      classifyAbnormalPayment({
        paymentId: 'p1',
        groupPayments: [pay('p1')],
        orderStatuses: ['CANCELLED', 'CANCELLED'],
      }),
    ).toBe('PAID_AFTER_EXPIRY');
  });

  it('còn một đơn chưa hủy ⇒ bình thường (hoàn tiền phải đi qua đơn)', () => {
    expect(
      classifyAbnormalPayment({
        paymentId: 'p1',
        groupPayments: [pay('p1')],
        orderStatuses: ['CANCELLED', 'PENDING'],
      }),
    ).toBeNull();
  });

  it('đơn REFUNDED không phải "thanh toán đến muộn"', () => {
    expect(
      classifyAbnormalPayment({
        paymentId: 'p1',
        groupPayments: [pay('p1')],
        orderStatuses: ['REFUNDED'],
      }),
    ).toBeNull();
  });

  it('DUPLICATE: khoản SUCCESS không phải bản sớm nhất — kể cả khi đơn vẫn sống', () => {
    const groupPayments = [
      pay('first', { paidAt: at(9) }),
      pay('second', { paidAt: at(10) }),
    ];

    expect(
      classifyAbnormalPayment({
        paymentId: 'second',
        groupPayments,
        orderStatuses: ['PENDING'],
      }),
    ).toBe('DUPLICATE');
    // Bản sớm nhất là khoản "chính", không phải bất thường khi đơn còn sống.
    expect(
      classifyAbnormalPayment({
        paymentId: 'first',
        groupPayments,
        orderStatuses: ['PENDING'],
      }),
    ).toBeNull();
  });

  it('khoản trùng mà mọi đơn đã hủy ⇒ vẫn DUPLICATE (ưu tiên nhãn trùng)', () => {
    expect(
      classifyAbnormalPayment({
        paymentId: 'second',
        groupPayments: [
          pay('first', { paidAt: at(9) }),
          pay('second', { paidAt: at(10) }),
        ],
        orderStatuses: ['CANCELLED'],
      }),
    ).toBe('DUPLICATE');
  });

  it.each([
    ['khoản chưa thu (PENDING)', { status: 'PENDING' as const }],
    ['lần thử FAILED', { status: 'FAILED' as const }],
    ['khoản đã hoàn hết (REFUNDED)', { status: 'REFUNDED' as const }],
    ['khoản COD', { method: 'COD' as const }],
  ])('%s ⇒ không phải thanh toán bất thường', (_name, overrides) => {
    expect(
      classifyAbnormalPayment({
        paymentId: 'p1',
        groupPayments: [pay('p1', overrides)],
        orderStatuses: ['CANCELLED'],
      }),
    ).toBeNull();
  });

  it('khoản không thuộc nhóm ⇒ null; nhóm không có đơn ⇒ không coi là đã hủy hết', () => {
    expect(
      classifyAbnormalPayment({
        paymentId: 'khong-co',
        groupPayments: [pay('p1')],
        orderStatuses: ['CANCELLED'],
      }),
    ).toBeNull();
    expect(
      classifyAbnormalPayment({
        paymentId: 'p1',
        groupPayments: [pay('p1')],
        orderStatuses: [],
      }),
    ).toBeNull();
  });
});

describe('toRefundRef', () => {
  it('bỏ gạch ngang của UUID ⇒ 32 ký tự hex, ổn định giữa các lần gọi', () => {
    const id = '3f2b8c1e-9a4d-4c7e-8b1f-0a2d5e6f7c89';

    expect(toRefundRef(id)).toBe('3f2b8c1e9a4d4c7e8b1f0a2d5e6f7c89');
    expect(toRefundRef(id)).toHaveLength(32);
    expect(toRefundRef(id)).toBe(toRefundRef(id));
  });
});
