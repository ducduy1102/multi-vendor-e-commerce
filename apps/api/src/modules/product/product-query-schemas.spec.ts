import {
  listProductsQuerySchema,
  PRODUCT_ATTRIBUTE_FILTER_MAX_VALUES,
  PRODUCT_ATTRIBUTE_FILTER_VALUE_MAX_LENGTH,
  PRODUCT_LIST_MAX_PAGE,
  PRODUCT_SEARCH_MAX_LENGTH,
} from '@ecommerce/types';

// Query của GET /products (packages/types/src/product.ts). Phần được siết ở Week9.md 5.2 là các tham số mà BE
// nhân thành việc tốn công ở DB: `page` (OFFSET), `attributeValues` (mỗi giá trị một điều kiện lồng nhau),
// `q` (tsquery). Hành vi cũ (mặc định, coerce số, gom 1 giá trị thành mảng) phải giữ nguyên.

describe('listProductsQuerySchema — hành vi cũ', () => {
  it('mặc định page=1, limit=12, sort=newest', () => {
    const query = listProductsQuerySchema.parse({});
    expect(query).toMatchObject({ page: 1, limit: 12, sort: 'newest' });
    expect(query.q).toBeUndefined();
    expect(query.attributeValues).toBeUndefined();
  });

  it('coerce page/limit từ chuỗi URL, gom một giá trị attributeValues thành mảng', () => {
    const query = listProductsQuerySchema.parse({
      page: '3',
      limit: '20',
      attributeValues: 'Đỏ',
    });
    expect(query.page).toBe(3);
    expect(query.limit).toBe(20);
    expect(query.attributeValues).toEqual(['Đỏ']);
  });

  it('giữ nguyên mảng nhiều giá trị', () => {
    expect(
      listProductsQuerySchema.parse({ attributeValues: ['Đỏ', 'M'] })
        .attributeValues,
    ).toEqual(['Đỏ', 'M']);
  });

  it('limit vẫn tối đa 50', () => {
    expect(listProductsQuerySchema.safeParse({ limit: '51' }).success).toBe(
      false,
    );
  });
});

describe('listProductsQuerySchema — shopSlug (trang shop công khai)', () => {
  it('không gửi hoặc gửi rỗng ⇒ undefined', () => {
    expect(listProductsQuerySchema.parse({}).shopSlug).toBeUndefined();
    expect(
      listProductsQuerySchema.parse({ shopSlug: '  ' }).shopSlug,
    ).toBeUndefined();
  });

  it('nhận slug (trim), giữ nguyên cùng các filter khác', () => {
    const query = listProductsQuerySchema.parse({
      shopSlug: ' shop-a ',
      shopId: 'shop-id',
      page: '2',
    });
    expect(query).toMatchObject({
      shopSlug: 'shop-a',
      shopId: 'shop-id',
      page: 2,
    });
  });

  it('slug lạ KHÔNG bị từ chối (chỉ không khớp shop nào ⇒ danh sách rỗng), chỉ chặn độ dài', () => {
    expect(
      listProductsQuerySchema.safeParse({ shopSlug: 'Khong-Hop-Le!' }).success,
    ).toBe(true);
    expect(
      listProductsQuerySchema.safeParse({ shopSlug: 'a'.repeat(151) }).success,
    ).toBe(false);
  });
});

describe('listProductsQuerySchema — trần chống truy vấn nặng', () => {
  it(`page nhận ${PRODUCT_LIST_MAX_PAGE}, từ chối ${PRODUCT_LIST_MAX_PAGE + 1}`, () => {
    expect(
      listProductsQuerySchema.safeParse({ page: String(PRODUCT_LIST_MAX_PAGE) })
        .success,
    ).toBe(true);
    expect(
      listProductsQuerySchema.safeParse({
        page: String(PRODUCT_LIST_MAX_PAGE + 1),
      }).success,
    ).toBe(false);
  });

  it(`attributeValues nhận tối đa ${PRODUCT_ATTRIBUTE_FILTER_MAX_VALUES} giá trị`, () => {
    const ok = Array.from(
      { length: PRODUCT_ATTRIBUTE_FILTER_MAX_VALUES },
      (_v, i) => `v${i}`,
    );
    expect(
      listProductsQuerySchema.safeParse({ attributeValues: ok }).success,
    ).toBe(true);
    expect(
      listProductsQuerySchema.safeParse({ attributeValues: [...ok, 'extra'] })
        .success,
    ).toBe(false);
  });

  it('một request lặp attributeValues hàng trăm lần bị từ chối', () => {
    const flood = Array.from({ length: 500 }, (_v, i) => `v${i}`);
    expect(
      listProductsQuerySchema.safeParse({ attributeValues: flood }).success,
    ).toBe(false);
  });

  it(`mỗi giá trị attributeValues tối đa ${PRODUCT_ATTRIBUTE_FILTER_VALUE_MAX_LENGTH} ký tự (cả dạng chuỗi lẻ lẫn mảng)`, () => {
    const tooLong = 'a'.repeat(PRODUCT_ATTRIBUTE_FILTER_VALUE_MAX_LENGTH + 1);
    expect(
      listProductsQuerySchema.safeParse({ attributeValues: tooLong }).success,
    ).toBe(false);
    expect(
      listProductsQuerySchema.safeParse({ attributeValues: ['ok', tooLong] })
        .success,
    ).toBe(false);
  });

  it(`q dài hơn ${PRODUCT_SEARCH_MAX_LENGTH} ký tự bị CẮT chứ không bị từ chối (không vỡ trang tìm kiếm)`, () => {
    const query = listProductsQuerySchema.parse({
      q: ` ${'a'.repeat(PRODUCT_SEARCH_MAX_LENGTH + 50)} `,
    });
    expect(query.q).toHaveLength(PRODUCT_SEARCH_MAX_LENGTH);
  });

  it('q cắt theo code point, không chẻ đôi cặp surrogate của emoji', () => {
    const query = listProductsQuerySchema.parse({
      q: '😀'.repeat(PRODUCT_SEARCH_MAX_LENGTH + 10),
    });
    expect(Array.from(query.q as string)).toHaveLength(
      PRODUCT_SEARCH_MAX_LENGTH,
    );
    // Không có surrogate lẻ: mã hoá rồi giải mã UTF-8 phải ra đúng chuỗi cũ.
    expect(Buffer.from(query.q as string, 'utf8').toString('utf8')).toBe(
      query.q,
    );
  });

  it('q ngắn giữ nguyên (đã trim)', () => {
    expect(listProductsQuerySchema.parse({ q: '  áo thun ' }).q).toBe(
      'áo thun',
    );
  });
});
