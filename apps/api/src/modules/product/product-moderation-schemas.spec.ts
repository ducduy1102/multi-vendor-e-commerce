import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ADMIN_USER_REASON_MAX_LENGTH,
  createProductSchema,
  productDetailSchema,
  productListItemSchema,
  productModerationResponseSchema,
  PRODUCT_TAKEDOWN_REASON_MAX_LENGTH,
  productStatusSchema,
  restoreProductSchema,
  sellerProductStatusSchema,
  takeDownProductSchema,
  updateProductSchema,
} from '@ecommerce/types';

// Hợp đồng gỡ / khôi phục sản phẩm vi phạm (Week11.md 5.7, D5): ai đặt được trạng thái nào, lý do, và khớp với CHECK ở DB.
const MIGRATIONS = join(__dirname, '..', '..', '..', 'prisma', 'migrations');

function migrationSql(suffix: string): string {
  const folder = readdirSync(MIGRATIONS).find((name) => name.endsWith(suffix));
  expect(folder).toBeDefined();
  return readFileSync(
    join(MIGRATIONS, folder as string, 'migration.sql'),
    'utf8',
  );
}

describe('trạng thái sản phẩm', () => {
  it('có TAKEN_DOWN trong trạng thái đọc được, nhưng chủ shop KHÔNG đặt được nó', () => {
    expect(productStatusSchema.options).toEqual([
      'DRAFT',
      'PUBLISHED',
      'ARCHIVED',
      'TAKEN_DOWN',
    ]);
    expect(sellerProductStatusSchema.options).toEqual([
      'DRAFT',
      'PUBLISHED',
      'ARCHIVED',
    ]);
  });

  it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'])(
    'PATCH nhận status %s',
    (status) => {
      expect(updateProductSchema.safeParse({ status }).success).toBe(true);
    },
  );

  it('PATCH từ chối status=TAKEN_DOWN (chỉ Admin đặt được) và trạng thái lạ', () => {
    expect(
      updateProductSchema.safeParse({ status: 'TAKEN_DOWN' }).success,
    ).toBe(false);
    expect(updateProductSchema.safeParse({ status: 'DELETED' }).success).toBe(
      false,
    );
  });

  it('tạo sản phẩm không có trường status để đặt (luôn DRAFT)', () => {
    const parsed = createProductSchema.safeParse({
      name: 'Áo',
      categoryId: 'cat',
      attributes: [],
      variants: [
        { sku: 'A', price: 1, stock: 1, images: [], attributeValues: [] },
      ],
      status: 'TAKEN_DOWN',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && 'status' in parsed.data).toBe(false);
  });
});

describe('lý do gỡ trong response của chủ shop', () => {
  const base = {
    id: 'p-1',
    categoryId: 'c-1',
    name: 'Dao',
    slug: 'dao',
    minPrice: '1',
    maxPrice: '1',
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    variants: [],
  };

  it('danh sách của shop: bắt buộc có takenDownReason (null hoặc chuỗi), không thể thiếu trường', () => {
    expect(
      productListItemSchema.safeParse({
        ...base,
        status: 'DRAFT',
        takenDownReason: null,
      }).success,
    ).toBe(true);
    expect(
      productListItemSchema.safeParse({
        ...base,
        status: 'TAKEN_DOWN',
        takenDownReason: 'Hàng cấm',
      }).success,
    ).toBe(true);
    expect(
      productListItemSchema.safeParse({ ...base, status: 'DRAFT' }).success,
    ).toBe(false);
  });

  it('chi tiết: cũng mang takenDownReason (null với mọi sản phẩm công khai)', () => {
    const detail = {
      ...base,
      shopId: 's-1',
      description: null,
      status: 'PUBLISHED',
      takenDownReason: null,
      attributes: [],
      shop: { name: 'Shop', slug: 'shop' },
      avgRating: 0,
      reviewCount: 0,
    };

    expect(productDetailSchema.safeParse(detail).success).toBe(true);
    const { takenDownReason: _omitted, ...withoutReason } = detail;
    void _omitted;
    expect(productDetailSchema.safeParse(withoutReason).success).toBe(false);
  });
});

describe('yêu cầu gỡ / khôi phục', () => {
  it('chỉ nhận { reason }: lý do bắt buộc, cắt khoảng trắng, nhiều dòng được giữ', () => {
    expect(
      takeDownProductSchema.parse({ reason: '  Hàng cấm \r\n dòng hai ' }),
    ).toEqual({
      reason: 'Hàng cấm \n dòng hai',
    });
    expect(restoreProductSchema.parse({ reason: 'Đã xét lại' })).toEqual({
      reason: 'Đã xét lại',
    });
  });

  it.each([
    ['thiếu', {}],
    ['rỗng', { reason: '' }],
    ['toàn khoảng trắng', { reason: '   ' }],
    ['quá 500 ký tự', { reason: 'a'.repeat(501) }],
    ['có ký tự điều khiển', { reason: `a${String.fromCharCode(0)}b` }],
  ])('lý do %s bị từ chối ở cả hai schema', (_name, body) => {
    expect(takeDownProductSchema.safeParse(body).success).toBe(false);
    expect(restoreProductSchema.safeParse(body).success).toBe(false);
  });

  it('đúng 500 ký tự được chấp nhận, 501 thì không (cận khớp CHECK ở DB)', () => {
    expect(
      takeDownProductSchema.safeParse({
        reason: 'a'.repeat(PRODUCT_TAKEDOWN_REASON_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      takeDownProductSchema.safeParse({
        reason: 'a'.repeat(PRODUCT_TAKEDOWN_REASON_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it('kết quả chỉ có id, trạng thái và mốc gỡ — không lý do, tên sản phẩm hay shop', () => {
    const parsed = productModerationResponseSchema.parse({
      product: {
        id: 'p-1',
        status: 'TAKEN_DOWN',
        takenDownAt: '2026-10-31T00:00:00.000Z',
        takenDownReason: 'bí mật',
        name: 'Dao',
      },
    });

    expect(Object.keys(parsed.product).sort()).toEqual([
      'id',
      'status',
      'takenDownAt',
    ]);
  });
});

describe('migration', () => {
  it('cận lý do bằng cận của lý do khoá tài khoản (schema dùng chung) và bằng CHECK ở DB', () => {
    expect(PRODUCT_TAKEDOWN_REASON_MAX_LENGTH).toBe(
      ADMIN_USER_REASON_MAX_LENGTH,
    );
    const sql = migrationSql('_add_product_takedown_columns');

    const match =
      /char_length\("taken_down_reason"\)\s+BETWEEN\s+1\s+AND\s+(\d+)/.exec(
        sql,
      );

    expect(Number(match?.[1])).toBe(PRODUCT_TAKEDOWN_REASON_MAX_LENGTH);
    expect(sql).toContain('"products_takedown_columns_consistent"');
  });

  it('giá trị enum và cột nằm ở HAI migration riêng (Postgres không dùng giá trị enum mới trong cùng giao dịch)', () => {
    const enumSql = migrationSql('_add_product_status_taken_down');
    const columnsSql = migrationSql('_add_product_takedown_columns');

    expect(enumSql).toMatch(
      /ALTER TYPE "ProductStatus" ADD VALUE 'TAKEN_DOWN'/,
    );
    expect(enumSql).not.toContain('taken_down_at');
    expect(columnsSql).toContain("'TAKEN_DOWN'");
    expect(columnsSql).not.toMatch(/ADD VALUE/);
  });

  it('migration enum được áp TRƯỚC migration cột (thứ tự theo tên thư mục)', () => {
    const names = readdirSync(MIGRATIONS).sort();
    const enumIndex = names.findIndex((n) =>
      n.endsWith('_add_product_status_taken_down'),
    );
    const columnsIndex = names.findIndex((n) =>
      n.endsWith('_add_product_takedown_columns'),
    );

    expect(enumIndex).toBeGreaterThanOrEqual(0);
    expect(columnsIndex).toBeGreaterThan(enumIndex);
  });
});
