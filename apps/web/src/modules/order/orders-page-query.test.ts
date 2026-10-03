import { describe, expect, it } from 'vitest';

import { parseOrdersPageQuery, parseSellerOrdersPageQuery } from './orders-page-query';

describe('parseOrdersPageQuery', () => {
  it('không có param -> không tab ("Tất cả"), trang 1', () => {
    expect(parseOrdersPageQuery({})).toEqual({ tab: undefined, page: 1 });
  });

  it('đọc đúng tab và page hợp lệ (page là chuỗi trên URL, được coerce thành số)', () => {
    expect(parseOrdersPageQuery({ tab: 'shipping', page: '3' })).toEqual({
      tab: 'shipping',
      page: 3,
    });
  });

  it.each(['awaiting-payment', 'pending', 'processing', 'shipping', 'completed', 'cancelled'])(
    'chấp nhận tab %s',
    (tab) => {
      expect(parseOrdersPageQuery({ tab }).tab).toBe(tab);
    },
  );

  it('tab lạ -> bỏ qua tab nhưng GIỮ page (mỗi param rơi về mặc định độc lập)', () => {
    expect(parseOrdersPageQuery({ tab: 'bogus', page: '4' })).toEqual({
      tab: undefined,
      page: 4,
    });
  });

  it.each(['abc', '0', '-1', '1.5', ''])('page %j không hợp lệ -> trang 1, GIỮ tab', (page) => {
    expect(parseOrdersPageQuery({ tab: 'pending', page })).toEqual({
      tab: 'pending',
      page: 1,
    });
  });

  it('param lặp (mảng) -> lấy giá trị đầu', () => {
    expect(parseOrdersPageQuery({ tab: ['completed', 'pending'], page: ['2', '5'] })).toEqual({
      tab: 'completed',
      page: 2,
    });
  });

  it('không bao giờ ném lỗi dù URL bị chỉnh bậy', () => {
    expect(() => parseOrdersPageQuery({ tab: ['', ''], page: ['x'], extra: 'y' })).not.toThrow();
  });
});

describe('parseSellerOrdersPageQuery', () => {
  it('không có param -> không tab, trang 1', () => {
    expect(parseSellerOrdersPageQuery({})).toEqual({ tab: undefined, page: 1 });
  });

  it('đọc đúng tab và page hợp lệ của Seller', () => {
    expect(parseSellerOrdersPageQuery({ tab: 'processing', page: '4' })).toEqual({
      tab: 'processing',
      page: 4,
    });
  });

  it('?tab=awaiting-payment KHÔNG hợp lệ với Seller -> rơi về "Tất cả" (BE sẽ trả 400), giữ nguyên trang', () => {
    // Đơn chưa thanh toán không được lộ cho Seller: tab này bị loại ở mức kiểu, không gửi lên API.
    expect(parseSellerOrdersPageQuery({ tab: 'awaiting-payment', page: '2' })).toEqual({
      tab: undefined,
      page: 2,
    });
    // Cùng giá trị đó vẫn hợp lệ với người mua — hai bộ đọc khác nhau có chủ đích.
    expect(parseOrdersPageQuery({ tab: 'awaiting-payment' }).tab).toBe('awaiting-payment');
  });

  it('tab lạ/page sai rơi về mặc định ĐỘC LẬP, param lặp lấy giá trị đầu, không bao giờ ném lỗi', () => {
    expect(parseSellerOrdersPageQuery({ tab: 'bogus', page: '3' })).toEqual({
      tab: undefined,
      page: 3,
    });
    expect(parseSellerOrdersPageQuery({ tab: 'completed', page: 'abc' })).toEqual({
      tab: 'completed',
      page: 1,
    });
    expect(parseSellerOrdersPageQuery({ tab: ['cancelled', 'pending'], page: ['2', '9'] })).toEqual(
      {
        tab: 'cancelled',
        page: 2,
      },
    );
    expect(() => parseSellerOrdersPageQuery({ tab: ['', ''], page: ['x'] })).not.toThrow();
  });
});
