import { ORDER_STATUSES_VISIBLE_TO_SELLER } from '@ecommerce/types';
import { sellerVisibleOrderFilter } from './seller-order-visibility';

describe('sellerVisibleOrderFilter', () => {
  it('mặc định: mọi trạng thái trừ AWAITING_PAYMENT, VÀ đơn phải từng ở PENDING', () => {
    expect(sellerVisibleOrderFilter()).toEqual({
      status: { in: [...ORDER_STATUSES_VISIBLE_TO_SELLER] },
      statusHistory: { some: { toStatus: 'PENDING' } },
    });
    expect(ORDER_STATUSES_VISIBLE_TO_SELLER).not.toContain('AWAITING_PAYMENT');
  });

  it('tab chỉ thu hẹp tập trạng thái, KHÔNG BAO GIỜ nới điều kiện "từng PENDING"', () => {
    expect(sellerVisibleOrderFilter(['CONFIRMED', 'PACKED'])).toEqual({
      status: { in: ['CONFIRMED', 'PACKED'] },
      statusHistory: { some: { toStatus: 'PENDING' } },
    });
    expect(sellerVisibleOrderFilter([])).toEqual({
      status: { in: [] },
      statusHistory: { some: { toStatus: 'PENDING' } },
    });
  });

  it('không sửa mảng truyền vào và luôn trả bản sao mới (không chia sẻ tham chiếu với hằng số dùng chung)', () => {
    const statuses = ['PENDING'] as const;
    const filter = sellerVisibleOrderFilter(statuses);

    expect(filter.status).toEqual({ in: ['PENDING'] });
    expect((filter.status as { in: unknown[] }).in).not.toBe(statuses);
    const a = sellerVisibleOrderFilter();
    const b = sellerVisibleOrderFilter();
    expect((a.status as { in: unknown[] }).in).not.toBe(
      (b.status as { in: unknown[] }).in,
    );
  });
});
