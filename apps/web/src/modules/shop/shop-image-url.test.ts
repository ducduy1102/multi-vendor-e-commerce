import { describe, expect, it } from 'vitest';

import { toSafeImageUrl } from './shop-image-url';

describe('toSafeImageUrl', () => {
  it('giữ nguyên URL https hợp lệ (kể cả host lạ, không chỉ Cloudinary)', () => {
    expect(toSafeImageUrl('https://res.cloudinary.com/demo/image/upload/logo.png')).toBe(
      'https://res.cloudinary.com/demo/image/upload/logo.png',
    );
    expect(toSafeImageUrl('https://cdn.example.org/a.jpg?x=1')).toBe(
      'https://cdn.example.org/a.jpg?x=1',
    );
  });

  it.each([
    ['http (nội dung hỗn hợp)', 'http://cdn.example.org/a.jpg'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['file:', 'file:///etc/passwd'],
    ['ftp:', 'ftp://example.org/a.jpg'],
    ['protocol-relative', '//cdn.example.org/a.jpg'],
    ['đường dẫn tương đối', '/images/a.jpg'],
    ['không phải URL', 'khong phai url'],
    ['viết hoa lẫn lộn javascript', 'JaVaScRiPt:alert(1)'],
  ])('loại %s', (_label, url) => {
    expect(toSafeImageUrl(url)).toBeNull();
  });

  it('null/undefined/rỗng -> null', () => {
    expect(toSafeImageUrl(null)).toBeNull();
    expect(toSafeImageUrl(undefined)).toBeNull();
    expect(toSafeImageUrl('')).toBeNull();
  });
});
