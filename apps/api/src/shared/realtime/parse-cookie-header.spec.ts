import { parseCookieHeader } from './parse-cookie-header';

const asObject = (header: string | undefined) =>
  Object.fromEntries(parseCookieHeader(header));

describe('parseCookieHeader', () => {
  it.each([
    ['không có header', undefined, {}],
    ['chuỗi rỗng', '', {}],
    ['một cookie', 'a=1', { a: '1' }],
    ['nhiều cookie', 'a=1; b=2;c=3', { a: '1', b: '2', c: '3' }],
    [
      'cắt khoảng trắng quanh tên và giá trị',
      ' a = 1 ;  b=2 ',
      { a: '1', b: '2' },
    ],
    ['giá trị rỗng giữ là chuỗi rỗng', 'a=; b=2', { a: '', b: '2' }],
    ['giá trị chứa dấu "="', 'a=b=c', { a: 'b=c' }],
    ['giải mã %-escape (UTF-8)', 'name=%E1%BB%87', { name: 'ệ' }],
    ['bỏ dấu nháy kép bao quanh', 'a="x y"', { a: 'x y' }],
    ['giữ nguyên nháy lẻ loi', 'a="x', { a: '"x' }],
  ])('%s', (_name, header, expected) => {
    expect(asObject(header)).toEqual(expected);
  });

  it('cặp không có "=" hoặc tên rỗng bị bỏ qua, các cặp khác vẫn đọc được', () => {
    expect(asObject('novalue; b=2')).toEqual({ b: '2' });
    expect(asObject('=x; b=2')).toEqual({ b: '2' });
    expect(asObject(';;; ;')).toEqual({});
  });

  it('trùng tên: lấy giá trị ĐẦU TIÊN (khớp cookie-parser của đường REST)', () => {
    expect(asObject('a=1; a=2; b=3; a=4')).toEqual({ a: '1', b: '3' });
  });

  it('giải mã %-escape hỏng thì giữ nguyên chuỗi gốc, không ném lỗi', () => {
    expect(asObject('a=%E0%A4%A')).toEqual({ a: '%E0%A4%A' });
    expect(asObject('a=%ZZ; b=ok')).toEqual({ a: '%ZZ', b: 'ok' });
  });

  it('đọc đúng một JWT (có dấu chấm, gạch ngang, gạch dưới) bên cạnh cookie khác', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSIsInJvbGUiOiJVU0VSIn0.sig_nature-x';
    const cookies = parseCookieHeader(
      `NEXT_LOCALE=vi; access_token=${jwt}; refresh_token=zzz`,
    );

    expect(cookies.get('access_token')).toBe(jwt);
    expect(cookies.get('NEXT_LOCALE')).toBe('vi');
  });

  it('tên như __proto__ / constructor chỉ là khoá bình thường, không đụng prototype', () => {
    const cookies = parseCookieHeader('__proto__=x; constructor=y');

    expect(cookies.get('__proto__')).toBe('x');
    expect(cookies.get('constructor')).toBe('y');
    expect(cookies.size).toBe(2);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
