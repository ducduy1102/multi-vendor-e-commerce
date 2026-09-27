import {
  buildSignData,
  formatVnpDate,
  isSignatureEqual,
  signVnpay,
  vnpEncode,
} from './vnpay-signature';

// VECTOR CỐ ĐỊNH: chuỗi ký được viết TAY đúng thuật toán trong tài liệu VNPay API 2.1.0 (tham số sắp theo
// tên tăng dần, mã hoá URL kiểu PHP urlencode, nối bằng `&`) và chữ ký kỳ vọng được tính ĐỘC LẬP bằng
// `openssl dgst -sha512 -hmac` — không bằng chính code đang test. LƯU Ý: đây KHÔNG phải vector do VNPay
// công bố (không lấy được); chữ ký thật của cổng chỉ được xác nhận khi thử sandbox VNPay có TmnCode thật.
const SECRET = 'SECRETKEY123456789';

const PAY_PARAMS = {
  vnp_Version: '2.1.0',
  vnp_Command: 'pay',
  vnp_TmnCode: 'TESTCODE',
  vnp_Amount: '25000000',
  vnp_CreateDate: '20260927103000',
  vnp_CurrCode: 'VND',
  vnp_IpAddr: '127.0.0.1',
  vnp_Locale: 'vn',
  vnp_OrderInfo: 'Thanh toan don hang ABC123',
  vnp_OrderType: 'other',
  vnp_ReturnUrl: 'https://api.example.com/api/v1/payments/vnpay/return',
  vnp_ExpireDate: '20260927104500',
  vnp_TxnRef: 'ABC123',
};
const PAY_SIGN_DATA =
  'vnp_Amount=25000000&vnp_Command=pay&vnp_CreateDate=20260927103000&vnp_CurrCode=VND&vnp_ExpireDate=20260927104500&vnp_IpAddr=127.0.0.1&vnp_Locale=vn&vnp_OrderInfo=Thanh+toan+don+hang+ABC123&vnp_OrderType=other&vnp_ReturnUrl=https%3A%2F%2Fapi.example.com%2Fapi%2Fv1%2Fpayments%2Fvnpay%2Freturn&vnp_TmnCode=TESTCODE&vnp_TxnRef=ABC123&vnp_Version=2.1.0';
const PAY_HASH =
  'fde697fdcf4e7673c6eaf7afaa778727a0dfa77e137359052b84de9b6e520b91783473d4bc4342d0d937689254a6c4b7169c3fd6a78d593b4b9e79a6d608d8dc';

describe('vnpEncode', () => {
  it.each([
    ['ABC123', 'ABC123'],
    ['Thanh toan don hang', 'Thanh+toan+don+hang'], // khoảng trắng → +, không phải %20
    ['https://a.b/c?d=e', 'https%3A%2F%2Fa.b%2Fc%3Fd%3De'],
    // PHP urlencode mã hoá cả 6 ký tự này, encodeURIComponent thì để nguyên:
    ["a b!'()*~", 'a+b%21%27%28%29%2A%7E'],
    ['Đà Nẵng', '%C4%90%C3%A0+N%E1%BA%B5ng'],
    ['a&b=c', 'a%26b%3Dc'],
    ['-_.', '-_.'],
  ])('%s → %s', (input, expected) => {
    expect(vnpEncode(input)).toBe(expected);
  });
});

describe('buildSignData + signVnpay (vector cố định)', () => {
  it('chuỗi ký khớp chuỗi viết tay theo tài liệu', () => {
    expect(buildSignData(PAY_PARAMS)).toBe(PAY_SIGN_DATA);
  });

  it('không phụ thuộc thứ tự khai tham số', () => {
    const reversed = Object.fromEntries(Object.entries(PAY_PARAMS).reverse());
    expect(buildSignData(reversed)).toBe(PAY_SIGN_DATA);
  });

  it('HMAC-SHA512 khớp chữ ký tính độc lập bằng openssl', () => {
    expect(signVnpay(PAY_SIGN_DATA, SECRET)).toBe(PAY_HASH);
  });

  it('vector thứ 2: ký tự đặc biệt được mã hoá kiểu PHP trước khi ký', () => {
    const data = buildSignData({
      vnp_TxnRef: 'X1',
      vnp_OrderInfo: "a b!'()*~",
    });
    expect(data).toBe('vnp_OrderInfo=a+b%21%27%28%29%2A%7E&vnp_TxnRef=X1');
    expect(signVnpay(data, SECRET)).toBe(
      '19d573f9b92dcef3354691b6153e94a6b775f4a267341866cff698b9e53a65cf3e6eb4996d5d16565fe27544503caf6c541b8e814f5ec30875d799cedbec769b',
    );
  });

  it('đổi 1 ký tự dữ liệu hoặc khoá thì chữ ký khác', () => {
    expect(signVnpay(`${PAY_SIGN_DATA}x`, SECRET)).not.toBe(PAY_HASH);
    expect(signVnpay(PAY_SIGN_DATA, `${SECRET}x`)).not.toBe(PAY_HASH);
  });
});

describe('isSignatureEqual', () => {
  const expected = signVnpay('data', SECRET);

  it('bằng nhau, không phân biệt hoa thường (hex)', () => {
    expect(isSignatureEqual(expected, expected)).toBe(true);
    expect(isSignatureEqual(expected.toUpperCase(), expected)).toBe(true);
  });

  it('khác nội dung', () => {
    expect(isSignatureEqual(`${expected.slice(0, -1)}0`, expected)).toBe(
      expected.endsWith('0'),
    );
    expect(isSignatureEqual('a'.repeat(expected.length), expected)).toBe(false);
  });

  it.each([
    ['rỗng', ''],
    ['ngắn', 'abc'],
    ['dài hơn 1 ký tự', `${expected}0`],
    ['rất dài', 'a'.repeat(100_000)],
    ['ký tự đa byte làm lệch độ dài buffer', 'é'.repeat(expected.length)],
  ])('độ dài lạ (%s) trả false, KHÔNG ném RangeError', (_l, actual) => {
    expect(() => isSignatureEqual(actual, expected)).not.toThrow();
    expect(isSignatureEqual(actual, expected)).toBe(false);
  });
});

describe('formatVnpDate', () => {
  it('đổi mốc UTC sang GMT+7 định dạng yyyyMMddHHmmss', () => {
    expect(formatVnpDate(new Date('2026-09-27T03:30:00Z'))).toBe(
      '20260927103000',
    );
  });

  it('qua nửa đêm UTC sang ngày kế tiếp ở GMT+7', () => {
    expect(formatVnpDate(new Date('2026-12-31T17:00:00Z'))).toBe(
      '20270101000000',
    );
    expect(formatVnpDate(new Date('2026-12-31T16:59:59Z'))).toBe(
      '20261231235959',
    );
  });

  it('bù số 0 ở tháng/ngày/giờ/phút/giây', () => {
    expect(formatVnpDate(new Date('2026-01-02T18:04:05Z'))).toBe(
      '20260103010405',
    );
  });

  describe('không phụ thuộc múi giờ máy chủ', () => {
    const instant = new Date('2026-09-27T03:30:00Z');
    const original = process.env.TZ;
    afterEach(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
      jest.restoreAllMocks();
    });

    it.each([
      'UTC',
      'Asia/Ho_Chi_Minh',
      'America/Los_Angeles',
      'Pacific/Kiritimati',
      'Europe/London',
    ])('TZ=%s', (tz) => {
      process.env.TZ = tz;
      expect(formatVnpDate(instant)).toBe('20260927103000');
    });

    it('không đọc bất kỳ API giờ địa phương nào (múi giờ lạ bị giả lập vẫn ra cùng kết quả)', () => {
      jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-600);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(99);
      jest.spyOn(Date.prototype, 'getDate').mockReturnValue(99);
      expect(formatVnpDate(instant)).toBe('20260927103000');
    });
  });
});
