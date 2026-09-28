import { HttpException } from '@nestjs/common';
import { AppException } from './app.exception';

describe('AppException', () => {
  it('là HttpException với đúng status, code và message', () => {
    const error = new AppException(409, 'CART_CHANGED', 'Cart changed');

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('CART_CHANGED');
    expect(error.message).toBe('Cart changed');
    expect(error.details).toBeUndefined();
  });

  it('mã có details: details nằm trong thân response và trên thuộc tính', () => {
    const error = new AppException(409, 'CART_FULL', 'Cart is full', {
      maxLines: 50,
    });

    expect(error.details).toEqual({ maxLines: 50 });
    expect(error.getResponse()).toEqual({
      message: 'Cart is full',
      code: 'CART_FULL',
      details: { maxLines: 50 },
    });
  });

  it('message giữ nguyên chữ (các nơi đang đọc error.message không vỡ)', () => {
    expect(
      new AppException(401, 'ACCOUNT_NOT_ACTIVE', 'ACCOUNT_NOT_ACTIVE').message,
    ).toBe('ACCOUNT_NOT_ACTIVE');
  });

  describe('details được kiểm kiểu lúc biên dịch theo mã (ts-jest báo lỗi nếu sai)', () => {
    it('mã KHÔNG có details thì không nhận tham số thứ 4', () => {
      // @ts-expect-error CART_CHANGED không có details
      const error = new AppException(409, 'CART_CHANGED', 'x', { a: 1 });
      expect(error).toBeDefined();
    });

    it('mã có details mà thiếu details', () => {
      // @ts-expect-error CART_FULL bắt buộc có details
      const error = new AppException(409, 'CART_FULL', 'x');
      expect(error).toBeDefined();
    });

    it('sai hình dạng details', () => {
      // @ts-expect-error maxLines phải là number
      const error = new AppException(409, 'CART_FULL', 'x', { maxLines: '50' });
      expect(error).toBeDefined();
    });

    it('sai tên field details', () => {
      const wrong = { maxLines: 1 };
      // @ts-expect-error INSUFFICIENT_STOCK cần { available }
      const error = new AppException(409, 'INSUFFICIENT_STOCK', '', wrong);
      expect(error).toBeDefined();
    });

    it('mã không tồn tại', () => {
      // @ts-expect-error NOT_A_CODE không thuộc ServerErrorCode
      const error = new AppException(409, 'NOT_A_CODE', 'x');
      expect(error).toBeDefined();
    });

    it('mã của client (NETWORK_ERROR) không được BE ném', () => {
      // @ts-expect-error mã do client tự sinh, không thuộc ServerErrorCode
      const error = new AppException(500, 'NETWORK_ERROR', 'x');
      expect(error).toBeDefined();
    });
  });
});
