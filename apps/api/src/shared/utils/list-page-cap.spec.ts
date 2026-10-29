import * as sharedTypes from '@ecommerce/types';

// Chốt chặn cho cả LỚP lỗi "?page= không có trần" (Week11.md 3.2): `page=1e21` vẫn qua `z.coerce.number().int().positive()`
// (1e21 là "số nguyên" của JS) rồi OFFSET/skip tràn số nguyên 64-bit ⇒ 500 thay vì 400. Test tự DÒ mọi schema query có trường
// `page` trong @ecommerce/types và đòi từng cái phải có trần, nên một danh sách phân trang thêm về sau mà quên trần sẽ làm test
// này đỏ — không phải nhớ thêm test cho từng endpoint. Dò bằng `_def.typeName` thay vì `instanceof`: apps/api và
// packages/types có thể giữ hai bản `zod` khác nhau (pnpm), khi đó `instanceof` luôn false và test xanh giả.
interface ZodLike {
  _def: { typeName?: string; schema?: ZodLike; innerType?: ZodLike };
  shape?: Record<string, ZodLike>;
  safeParse(value: unknown): { success: boolean };
  parse(value: unknown): unknown;
}

function unwrapEffects(schema: ZodLike): ZodLike {
  return schema._def.typeName === 'ZodEffects' && schema._def.schema
    ? unwrapEffects(schema._def.schema)
    : schema;
}

function paginatedQuerySchemas(): [string, ZodLike][] {
  const found: [string, ZodLike][] = [];
  for (const [name, value] of Object.entries(sharedTypes)) {
    if (typeof value !== 'object' || value === null || !('_def' in value)) {
      continue;
    }
    const schema = unwrapEffects(value as ZodLike);
    // Schema QUERY có `page` kèm giá trị mặc định (ZodDefault); schema RESPONSE cũng có `page` nhưng bắt buộc.
    if (
      schema._def.typeName === 'ZodObject' &&
      schema.shape?.page?._def.typeName === 'ZodDefault'
    ) {
      found.push([name, schema]);
    }
  }
  return found;
}

describe('trần số trang của mọi danh sách phân trang theo offset', () => {
  const schemas = paginatedQuerySchemas();

  it('dò được các danh sách đã biết (chặn xanh giả do dò hụt)', () => {
    const names = schemas.map(([name]) => name);

    expect(names.length).toBeGreaterThanOrEqual(11);
    expect(names).toEqual(
      expect.arrayContaining([
        'adminShopListQuerySchema',
        'adminUserListQuerySchema',
        'adminRefundListQuerySchema',
        'adminRefundRequestListQuerySchema',
        'adminRefundablePaymentListQuerySchema',
        'orderListQuerySchema',
        'sellerOrderListQuerySchema',
        'sellerRefundRequestListQuerySchema',
        'listReviewsQuerySchema',
        'sellerReviewListQuerySchema',
        'listProductsQuerySchema',
      ]),
    );
  });

  it.each(schemas)('%s: có trần, giá trị tràn bị từ chối', (_name, schema) => {
    const page = schema.shape?.page as ZodLike;

    // Mặc định vẫn là trang 1 và số trang hợp lệ vẫn qua.
    expect(page.parse(undefined)).toBe(1);
    expect(page.safeParse('1').success).toBe(true);
    expect(page.safeParse('100').success).toBe(true);
    // Mọi trần đang dùng ≤ 100.000 (LIST_MAX_PAGE 10.000; riêng danh sách người dùng của Admin 100.000).
    expect(page.safeParse('100001').success).toBe(false);
    // Các giá trị mà `.int()` của Zod vẫn coi là số nguyên nhưng làm OFFSET tràn.
    for (const huge of ['1e21', '1e300', '9007199254740993']) {
      expect(page.safeParse(huge).success).toBe(false);
    }
    // Vẫn từ chối những thứ không phải số trang.
    for (const bad of ['0', '-1', '1.5', 'abc']) {
      expect(page.safeParse(bad).success).toBe(false);
    }
  });

  it('LIST_MAX_PAGE là biên đúng của các danh sách dùng nó: qua ở biên, từ chối ngay sau biên', () => {
    const shops = sharedTypes.adminShopListQuerySchema.shape.page;

    expect(shops.safeParse(String(sharedTypes.LIST_MAX_PAGE)).success).toBe(
      true,
    );
    expect(shops.safeParse(String(sharedTypes.LIST_MAX_PAGE + 1)).success).toBe(
      false,
    );
  });
});
