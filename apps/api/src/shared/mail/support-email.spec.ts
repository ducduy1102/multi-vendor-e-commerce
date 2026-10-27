import { getSupportEmail } from './support-email';

// ENV tuỳ chọn SUPPORT_EMAIL (Week11.md D15): sai / thiếu / rỗng đều ra null, không bao giờ ném.
describe('getSupportEmail', () => {
  const saved = process.env.SUPPORT_EMAIL;

  afterEach(() => {
    if (saved === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = saved;
  });

  it('không đặt ⇒ null', () => {
    delete process.env.SUPPORT_EMAIL;

    expect(getSupportEmail()).toBeNull();
  });

  it.each([
    ['rỗng (".env" khai `SUPPORT_EMAIL=`)', ''],
    ['toàn khoảng trắng', '   '],
  ])(
    '%s ⇒ null, không phải chuỗi rỗng (rules/general.md mục 4)',
    (_name, value) => {
      process.env.SUPPORT_EMAIL = value;

      expect(getSupportEmail()).toBeNull();
    },
  );

  it('địa chỉ hợp lệ được cắt khoảng trắng hai đầu', () => {
    process.env.SUPPORT_EMAIL = '  help@example.com\n';

    expect(getSupportEmail()).toBe('help@example.com');
  });

  it.each([
    ['không có @', 'help.example.com'],
    ['thiếu tên miền', 'help@'],
    ['có khoảng trắng giữa', 'he lp@example.com'],
    ['quá dài', `${'a'.repeat(250)}@example.com`],
    ['nhiều địa chỉ', 'a@example.com,b@example.com'],
  ])('sai định dạng (%s) ⇒ null thay vì ném', (_name, value) => {
    process.env.SUPPORT_EMAIL = value;

    expect(() => getSupportEmail()).not.toThrow();
    expect(getSupportEmail()).toBeNull();
  });

  it('đọc ENV mỗi lần gọi (đổi cấu hình có hiệu lực ngay, test đổi ENV được)', () => {
    process.env.SUPPORT_EMAIL = 'a@example.com';
    expect(getSupportEmail()).toBe('a@example.com');

    process.env.SUPPORT_EMAIL = 'b@example.com';
    expect(getSupportEmail()).toBe('b@example.com');
  });
});
