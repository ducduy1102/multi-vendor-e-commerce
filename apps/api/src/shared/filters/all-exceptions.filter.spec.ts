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
  let logged: jest.SpyInstance;

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
    logged = jest
      .spyOn(filter['logger'], 'error')
      .mockImplementation(() => undefined);
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

  // Lỗi 4xx của thư viện HTTP (body-parser...) là đối tượng kiểu `http-errors`, không phải HttpException.
  describe('lỗi 4xx kiểu http-errors (ném ra ngoài Nest)', () => {
    const httpError = (props: Record<string, unknown>, message = 'boom') =>
      Object.assign(new Error(message), props);
    const GENERIC = 'Đã có lỗi xảy ra, vui lòng thử lại sau';

    it('body quá lớn (413, expose) ⇒ đúng status và thông điệp của thư viện, body đúng hình, KHÔNG log', () => {
      const { status: s, body } = catchWith(
        httpError(
          {
            status: 413,
            statusCode: 413,
            expose: true,
            type: 'entity.too.large',
          },
          'request entity too large',
        ),
      );

      expect(s).toEqual([413]);
      expect(body).toStrictEqual([
        { success: false, data: null, message: 'request entity too large' },
      ]);
      expect(logged).not.toHaveBeenCalled();
    });

    it('chỉ có `status` hoặc chỉ có `statusCode` đều nhận; có cả hai thì ưu tiên `statusCode`', () => {
      expect(
        catchWith(httpError({ status: 415, expose: true })).status,
      ).toEqual([415]);
      jest.clearAllMocks();
      expect(
        catchWith(httpError({ statusCode: 400, expose: true })).status,
      ).toEqual([400]);
      jest.clearAllMocks();
      expect(
        catchWith(httpError({ statusCode: 413, status: 400, expose: true }))
          .status,
      ).toEqual([413]);
    });

    it.each([
      ['không có expose', { status: 413 }],
      ['expose = false', { status: 413, expose: false }],
      ['expose là chuỗi "true"', { status: 413, expose: 'true' }],
      ['status 5xx', { status: 503, expose: true }],
      ['status 399', { status: 399, expose: true }],
      ['status 600', { status: 600, expose: true }],
      ['status là chuỗi', { status: '413', expose: true }],
      ['status thập phân', { status: 413.5, expose: true }],
      ['status NaN', { status: NaN, expose: true }],
      ['không có status', { expose: true }],
    ])(
      '%s ⇒ vẫn là lỗi hệ thống 500, thông điệp chung, có log (không lộ thông điệp gốc)',
      (_name, props) => {
        const { status: s, body } = catchWith(
          httpError(props, 'chi tiết nội bộ'),
        );

        expect(s).toEqual([500]);
        expect(body).toStrictEqual([
          { success: false, data: null, message: GENERIC },
        ]);
        expect(logged).toHaveBeenCalledTimes(1);
      },
    );

    it('lỗi của HTTP client gọi dịch vụ ngoài (có status 4xx nhưng không có expose) KHÔNG bị đưa thông điệp ra response', () => {
      const upstream = httpError(
        { status: 401, response: { data: 'api key sk_live_123 invalid' } },
        'Request failed with status code 401: api key sk_live_123 invalid',
      );

      const { status: s, body } = catchWith(upstream);

      expect(s).toEqual([500]);
      expect(JSON.stringify(body)).not.toContain('sk_live_123');
    });

    it('message không phải chuỗi ⇒ 500 chung', () => {
      const { status: s } = catchWith({
        status: 413,
        expose: true,
        message: 42,
      });

      expect(s).toEqual([500]);
    });

    it('giá trị không phải object (chuỗi, null, undefined) ⇒ 500 chung, không ném', () => {
      for (const value of ['lỗi', null, undefined, 413]) {
        jest.clearAllMocks();
        expect(catchWith(value).status).toEqual([500]);
      }
    });
  });
});
