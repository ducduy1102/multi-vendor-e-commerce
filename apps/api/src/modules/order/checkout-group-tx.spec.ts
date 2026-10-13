import type { OrderStatus } from '@prisma/client';
import type { TxClient } from '../../shared/prisma/tx-client';
import {
  decideCodPaymentStatus,
  lockGroupOrders,
  settleCodPayment,
  shouldReleaseVoucher,
} from './checkout-group-tx';

describe('decideCodPaymentStatus', () => {
  // [mô tả, trạng thái các đơn trong nhóm, kết quả]
  const CASES: [string, OrderStatus[], 'SUCCESS' | 'CANCELLED' | null][] = [
    ['nhóm không có đơn nào', [], null],
    ['một đơn COMPLETED', ['COMPLETED'], 'SUCCESS'],
    [
      'một đơn CANCELLED (nhóm hủy hết) ⇒ không thu',
      ['CANCELLED'],
      'CANCELLED',
    ],
    [
      'nhiều đơn đều CANCELLED ⇒ không thu',
      ['CANCELLED', 'CANCELLED'],
      'CANCELLED',
    ],
    [
      'COMPLETED + CANCELLED ⇒ đã thu (đơn bị hủy không cản)',
      ['COMPLETED', 'CANCELLED'],
      'SUCCESS',
    ],
    ['một đơn REFUNDED ⇒ đã thu (từng giao rồi hoàn)', ['REFUNDED'], 'SUCCESS'],
    [
      'REFUNDED + CANCELLED ⇒ vẫn coi là đã thu',
      ['REFUNDED', 'CANCELLED'],
      'SUCCESS',
    ],
    ['COMPLETED + REFUNDED ⇒ đã thu', ['COMPLETED', 'REFUNDED'], 'SUCCESS'],
    ['còn một đơn PENDING', ['COMPLETED', 'PENDING'], null],
    ['còn một đơn CONFIRMED', ['CANCELLED', 'CONFIRMED'], null],
    ['còn một đơn PACKED', ['COMPLETED', 'PACKED'], null],
    ['còn một đơn SHIPPING', ['COMPLETED', 'SHIPPING'], null],
    ['mọi đơn PENDING (chưa đơn nào tới đích)', ['PENDING', 'PENDING'], null],
    ['còn đơn AWAITING_PAYMENT', ['CANCELLED', 'AWAITING_PAYMENT'], null],
  ];

  it.each(CASES)('%s', (_name, statuses, expected) => {
    expect(decideCodPaymentStatus(statuses)).toBe(expected);
  });
});

describe('settleCodPayment', () => {
  function txWith(statuses: OrderStatus[]) {
    const tx = {
      order: {
        findMany: jest
          .fn()
          .mockResolvedValue(statuses.map((status) => ({ status }))),
      },
      payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    return tx;
  }

  it('chỉ đụng Payment COD đang PENDING của đúng nhóm — gọi lặp không ghi đè Payment đã chốt', async () => {
    const tx = txWith(['COMPLETED']);

    await settleCodPayment(tx as unknown as TxClient, 'g1');

    expect(tx.order.findMany).toHaveBeenCalledWith({
      where: { checkoutGroupId: 'g1' },
      select: { status: true },
    });
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { checkoutGroupId: 'g1', method: 'COD', status: 'PENDING' },
      data: { status: 'SUCCESS', paidAt: expect.any(Date) as Date },
    });
  });

  it('nhóm hủy hết ⇒ Payment COD → CANCELLED (không paidAt), không còn kẹt PENDING', async () => {
    const tx = txWith(['CANCELLED', 'CANCELLED']);

    await settleCodPayment(tx as unknown as TxClient, 'g1');

    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { checkoutGroupId: 'g1', method: 'COD', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  });

  it('đơn REFUNDED được coi như đã thu', async () => {
    const tx = txWith(['REFUNDED', 'CANCELLED']);

    await settleCodPayment(tx as unknown as TxClient, 'g1');

    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { checkoutGroupId: 'g1', method: 'COD', status: 'PENDING' },
      data: { status: 'SUCCESS', paidAt: expect.any(Date) as Date },
    });
  });

  it('còn đơn chưa tới đích ⇒ không ghi gì', async () => {
    const tx = txWith(['COMPLETED', 'SHIPPING']);

    await settleCodPayment(tx as unknown as TxClient, 'g1');

    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });
});

describe('lockGroupOrders', () => {
  it('khoá cả nhóm theo id tăng dần và trả id + trạng thái', async () => {
    const rows = [
      { id: 'a', status: 'PENDING' },
      { id: 'b', status: 'CANCELLED' },
    ];
    const $queryRaw = jest.fn().mockResolvedValue(rows);

    const result = await lockGroupOrders(
      { $queryRaw } as unknown as TxClient,
      'g1',
    );

    expect(result).toEqual(rows);
    const sql = ($queryRaw.mock.calls[0] as [TemplateStringsArray])[0].join(
      '?',
    );
    expect(sql).toContain('FROM orders WHERE checkout_group_id = ?');
    expect(sql).toContain('ORDER BY id FOR UPDATE');
  });
});

describe('shouldReleaseVoucher (Week9.md 1.7)', () => {
  const order = (status: OrderStatus, discountAmount: number) => ({
    status,
    discountAmount,
  });

  // Bảng quyết định: nhóm 1 đơn / 2 đơn × voucher shop (1 đơn có giảm) / voucher sàn (nhiều đơn có giảm)
  // × hủy 1 / hủy hết × CANCELLED / REFUNDED.
  const CASES: [
    string,
    { status: OrderStatus; discountAmount: number }[],
    boolean,
  ][] = [
    [
      'nhóm 1 đơn có giảm, bị hủy ⇒ trả lượt',
      [order('CANCELLED', 20000)],
      true,
    ],
    ['nhóm 1 đơn có giảm, còn sống ⇒ giữ', [order('PENDING', 20000)], false],
    [
      'nhóm 1 đơn có giảm, đã giao rồi hoàn (REFUNDED) ⇒ KHÔNG trả lượt',
      [order('REFUNDED', 20000)],
      false,
    ],
    [
      'nhóm 1 đơn có giảm, đã COMPLETED ⇒ giữ',
      [order('COMPLETED', 20000)],
      false,
    ],
    [
      'voucher shop: đơn có giảm bị hủy, đơn kia (không giảm) còn sống ⇒ trả lượt (không ai còn hưởng giảm)',
      [order('CANCELLED', 20000), order('PENDING', 0)],
      true,
    ],
    [
      'voucher shop: đơn không giảm bị hủy, đơn có giảm còn sống ⇒ giữ',
      [order('PENDING', 20000), order('CANCELLED', 0)],
      false,
    ],
    [
      'voucher sàn chia cho 2 đơn: hủy 1 đơn ⇒ còn đơn hưởng giảm ⇒ giữ',
      [order('CANCELLED', 10000), order('CONFIRMED', 10000)],
      false,
    ],
    [
      'voucher sàn chia cho 2 đơn: hủy cả 2 ⇒ trả lượt',
      [order('CANCELLED', 10000), order('CANCELLED', 10000)],
      true,
    ],
    [
      'voucher sàn: 1 đơn CANCELLED, 1 đơn REFUNDED ⇒ giữ (đơn REFUNDED đã dùng voucher thật)',
      [order('CANCELLED', 10000), order('REFUNDED', 10000)],
      false,
    ],
    [
      'nhóm không có đơn nào hưởng giảm giá ⇒ không có gì để trả',
      [order('CANCELLED', 0), order('CANCELLED', 0)],
      false,
    ],
    ['nhóm rỗng ⇒ không trả', [], false],
  ];

  it.each(CASES)('%s', (_name, orders, expected) => {
    expect(shouldReleaseVoucher(orders)).toBe(expected);
  });
});
