import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

// Nhánh code/details chỉ THÊM — mọi nhánh cũ phải giữ body y hệt cũ (Week7.md 1.16).
describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let status: jest.Mock;
  let json: jest.Mock;

  const catchWith = (exception: unknown) => {
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return {
      status: status.mock.calls[0] as unknown[],
      body: json.mock.calls[0] as unknown[],
    };
  };

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    json = jest.fn();
    status = jest.fn(() => ({ json }));
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  describe('lỗi KHÔNG có mã — body y hệt cũ (không có key code/details)', () => {
    it('HttpException có sẵn của Nest', () => {
      const { status: s, body } = catchWith(new NotFoundException('Nope'));

      expect(s).toEqual([404]);
      expect(body).toStrictEqual([
        { success: false, data: null, message: 'Nope' },
      ]);
    });

    it('HttpException dạng chuỗi', () => {
      const { body } = catchWith(new HttpException('plain', 418));

      expect(body).toStrictEqual([
        { success: false, data: null, message: 'plain' },
      ]);
    });

    it('message dạng mảng (ValidationPipe) được nối bằng "; "', () => {
      const { body } = catchWith(new BadRequestException(['a', 'b']));

      expect(body).toStrictEqual([
        { success: false, data: null, message: 'a; b' },
      ]);
    });

    it('body có field `code` không phải chuỗi thì bị bỏ qua, không rò vào response', () => {
      const { body } = catchWith(
        new HttpException({ message: 'x', code: 123, details: { a: 1 } }, 400),
      );

      expect(body).toStrictEqual([
        { success: false, data: null, message: 'x' },
      ]);
    });

    it('lỗi không lường trước — 500, message chung, không lộ chi tiết, có log', () => {
      const { status: s, body } = catchWith(new Error('secret db password'));

      expect(s).toEqual([500]);
      expect(body).toStrictEqual([
        {
          success: false,
          data: null,
          message: 'Đã có lỗi xảy ra, vui lòng thử lại sau',
        },
      ]);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(filter['logger'].error).toHaveBeenCalled();
    });
  });

  describe('lỗi CÓ mã (AppException)', () => {
    it('thêm code, giữ message và status', () => {
      const { status: s, body } = catchWith(
        new AppException(409, 'CART_CHANGED', 'Cart changed'),
      );

      expect(s).toEqual([409]);
      expect(body).toStrictEqual([
        {
          success: false,
          data: null,
          message: 'Cart changed',
          code: 'CART_CHANGED',
        },
      ]);
    });

    it('thêm cả details khi có', () => {
      const { body } = catchWith(
        new AppException(409, 'INSUFFICIENT_STOCK', 'Not enough', {
          available: 2,
        }),
      );

      expect(body).toStrictEqual([
        {
          success: false,
          data: null,
          message: 'Not enough',
          code: 'INSUFFICIENT_STOCK',
          details: { available: 2 },
        },
      ]);
    });

    it('không có key details khi mã không có details', () => {
      const { body } = catchWith(
        new AppException(403, 'EMAIL_NOT_VERIFIED', 'EMAIL_NOT_VERIFIED'),
      );

      expect(body[0]).not.toHaveProperty('details');
    });
  });

  it('ConflictException thường (chưa di chuyển) không bị gắn code', () => {
    const { body } = catchWith(new ConflictException('SKU already exists'));

    expect(body[0]).not.toHaveProperty('code');
  });
});
