import {
  decodeOAuthState,
  encodeOAuthState,
  parseOAuthLocale,
} from './oauth-state';

describe('parseOAuthLocale', () => {
  it.each([
    ['vi', 'vi'],
    ['en', 'en'],
  ])('%p là ngôn ngữ hỗ trợ — giữ nguyên', (input, expected) => {
    expect(parseOAuthLocale(input)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [''],
    ['fr'],
    ['EN'],
    [' en'],
    ['en/../evil'],
    [['en']],
    [{ a: 'en' }],
    [1],
  ])('%p — rơi về mặc định vi', (input) => {
    expect(parseOAuthLocale(input)).toBe('vi');
  });
});

describe('encodeOAuthState', () => {
  it('không có gì để mang (không next, ngôn ngữ mặc định) — không có state', () => {
    expect(encodeOAuthState({ next: null, locale: 'vi' })).toBeUndefined();
  });

  it('chỉ next', () => {
    expect(encodeOAuthState({ next: '/checkout', locale: 'vi' })).toBe(
      'n=%2Fcheckout',
    );
  });

  it('chỉ ngôn ngữ en', () => {
    expect(encodeOAuthState({ next: null, locale: 'en' })).toBe('l=en');
  });

  it('cả hai; next có query/ký tự đặc biệt không phá cấu trúc state', () => {
    const encoded = encodeOAuthState({
      next: '/cart?voucherCode=SALE10&x=a b',
      locale: 'en',
    });

    expect(encoded).toBeDefined();
    expect(decodeOAuthState(encoded)).toEqual({
      next: '/cart?voucherCode=SALE10&x=a b',
      locale: 'en',
    });
  });
});

describe('decodeOAuthState', () => {
  it.each([[undefined], [null], [''], [123], [['n=/checkout']], [{ n: '/x' }]])(
    '%p — không có gì: next null, vi',
    (raw) => {
      expect(decodeOAuthState(raw)).toEqual({ next: null, locale: 'vi' });
    },
  );

  it('định dạng cũ (state = next thuần) — vẫn đọc được, ngôn ngữ vi', () => {
    expect(decodeOAuthState('/cart?voucherCode=SALE10')).toEqual({
      next: '/cart?voucherCode=SALE10',
      locale: 'vi',
    });
  });

  it.each([
    ['open redirect', '//evil.com'],
    ['URL tuyệt đối', 'https://evil.com'],
    ['ngoài allow-list', '/login'],
    ['CRLF', '/checkout%0d%0aX:1'],
  ])('định dạng cũ với next bẩn (%s) — bỏ next', (_label, raw) => {
    expect(decodeOAuthState(raw).next).toBeNull();
  });

  it('định dạng mới: next bẩn bị bỏ nhưng ngôn ngữ hợp lệ vẫn giữ', () => {
    expect(decodeOAuthState('n=%2F%2Fevil.com&l=en')).toEqual({
      next: null,
      locale: 'en',
    });
  });

  it('định dạng mới: ngôn ngữ bẩn rơi về vi nhưng next hợp lệ vẫn giữ', () => {
    expect(decodeOAuthState('n=%2Fcheckout&l=fr')).toEqual({
      next: '/checkout',
      locale: 'vi',
    });
  });

  it('tham số lạ trong state bị bỏ qua', () => {
    expect(
      decodeOAuthState('x=1&l=en&redirect=https%3A%2F%2Fevil.com'),
    ).toEqual({
      next: null,
      locale: 'en',
    });
  });
});
