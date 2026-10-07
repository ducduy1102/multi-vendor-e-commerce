import { describe, expect, it } from 'vitest';

import { buildShopNotes } from './shop-notes';

const ORDERS = [{ shopId: 'shop-1' }, { shopId: 'shop-2' }];

describe('buildShopNotes', () => {
  it('chưa ai nhập gì ⇒ undefined (không gửi map rỗng)', () => {
    expect(buildShopNotes(ORDERS, {})).toBeUndefined();
  });

  it('chỉ gửi shop có nhập', () => {
    expect(buildShopNotes(ORDERS, { 'shop-1': 'Gọi trước khi giao' })).toEqual({
      'shop-1': 'Gọi trước khi giao',
    });
  });

  it('gửi đủ khi cả 2 shop đều có lời nhắn, đúng khoá shopId', () => {
    expect(buildShopNotes(ORDERS, { 'shop-1': 'A', 'shop-2': 'B' })).toEqual({
      'shop-1': 'A',
      'shop-2': 'B',
    });
  });

  it('lời nhắn toàn khoảng trắng/xuống dòng coi như không nhập', () => {
    expect(buildShopNotes(ORDERS, { 'shop-1': '   ', 'shop-2': '\n \n' })).toBeUndefined();
  });

  it('gửi nguyên văn phần đã gõ (BE trim), không tự cắt hay escape', () => {
    const raw = '  <b>đậm</b> & "quote"\ndòng 2  ';
    expect(buildShopNotes(ORDERS, { 'shop-1': raw })).toEqual({ 'shop-1': raw });
  });

  it('bỏ lời nhắn của shop không còn trong xem trước (giỏ vừa đổi)', () => {
    expect(
      buildShopNotes([{ shopId: 'shop-2' }], { 'shop-1': 'shop đã rời giỏ', 'shop-2': 'còn' }),
    ).toEqual({ 'shop-2': 'còn' });
  });

  it('không có đơn nào ⇒ undefined', () => {
    expect(buildShopNotes([], { 'shop-1': 'x' })).toBeUndefined();
  });
});
