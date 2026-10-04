import { DEFAULT_CORS_ORIGINS, readCorsOrigins } from './read-cors-origins';

describe('readCorsOrigins', () => {
  const original = process.env.CORS_ORIGIN;

  afterEach(() => {
    if (original === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = original;
  });

  it('không khai biến — dùng mặc định', () => {
    delete process.env.CORS_ORIGIN;
    expect(readCorsOrigins()).toEqual(DEFAULT_CORS_ORIGINS);
  });

  // Hồi quy: `CORS_ORIGIN=` trong .env (copy từ .env.example) từng ra `['']` và chặn mọi origin.
  it.each(['', '   ', ',', ' , ,'])(
    'giá trị %p (rỗng/chỉ có khoảng trắng và dấu phẩy) — về mặc định, không ra origin rỗng',
    (value) => {
      process.env.CORS_ORIGIN = value;
      expect(readCorsOrigins()).toEqual(DEFAULT_CORS_ORIGINS);
    },
  );

  it('khai 1 origin — dùng đúng origin đó, không thêm mặc định', () => {
    process.env.CORS_ORIGIN = 'https://shop.example.com';
    expect(readCorsOrigins()).toEqual(['https://shop.example.com']);
  });

  it('khai nhiều origin — tách theo dấu phẩy, cắt khoảng trắng, bỏ phần tử rỗng', () => {
    process.env.CORS_ORIGIN =
      ' https://shop.example.com , https://admin.example.com,, ';
    expect(readCorsOrigins()).toEqual([
      'https://shop.example.com',
      'https://admin.example.com',
    ]);
  });
});
