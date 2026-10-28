import {
  ORDER_INTERNAL_NOTE_MAX_LENGTH,
  orderDetailSchema,
  orderInternalNoteTextSchema,
  orderListItemSchema,
  sellerOrderDetailSchema,
  sellerOrderListItemSchema,
  updateOrderInternalNoteSchema,
} from '@ecommerce/types';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Hợp đồng dùng chung của ghi chú nội bộ trên đơn (packages/types/src/order.ts, Week11.md 4.4). packages/types không có test runner
// riêng — test ở đây (cùng precedent admin-note-schemas.spec.ts). Ký tự đặc biệt dựng bằng String.fromCharCode để tệp nguồn không
// chứa ký tự điều khiển thật.
const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const BIDI_OVERRIDE = String.fromCharCode(0x202e);
const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe('nội dung ghi chú nội bộ', () => {
  it('cắt khoảng trắng hai đầu và chuẩn hoá CRLF/CR về LF, giữ xuống dòng giữa các dòng', () => {
    expect(
      orderInternalNoteTextSchema.parse('  dòng 1\r\ndòng 2\rdòng 3  '),
    ).toBe('dòng 1\ndòng 2\ndòng 3');
  });

  it.each(['', '   ', '\n\n'])(
    'rỗng hoặc chỉ khoảng trắng (%j) HỢP LỆ và ra chuỗi rỗng — đó là cách xoá ghi chú',
    (value) => {
      expect(orderInternalNoteTextSchema.parse(value)).toBe('');
    },
  );

  it('thiếu hoặc sai kiểu ⇒ key i18n "không hợp lệ"', () => {
    for (const value of [undefined, 5, {}]) {
      const result = orderInternalNoteTextSchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(
        'order.validationInternalNoteInvalid',
      );
    }
  });

  it('đúng cận 500 ký tự thì qua (cả khi có khoảng trắng thừa), 501 thì bị từ chối với key "quá dài"', () => {
    expect(
      orderInternalNoteTextSchema.safeParse(
        `  ${'a'.repeat(ORDER_INTERNAL_NOTE_MAX_LENGTH)}  `,
      ).success,
    ).toBe(true);

    const result = orderInternalNoteTextSchema.safeParse(
      'a'.repeat(ORDER_INTERNAL_NOTE_MAX_LENGTH + 1),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      'order.validationInternalNoteTooLong',
    );
  });

  it.each([
    ['NUL', `abc${NUL}def`],
    ['tab', `abc${TAB}def`],
    ['bidi-override', `abc${BIDI_OVERRIDE}def`],
    ['dấu phân dòng Unicode', `abc${LINE_SEPARATOR}def`],
  ])('ký tự không an toàn (%s) bị từ chối với key "không an toàn"', (_n, v) => {
    const result = orderInternalNoteTextSchema.safeParse(v);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      'order.validationInternalNoteUnsafe',
    );
  });

  it('không chặn <, > và dấu nháy: ghi chú hiển thị như chữ (React tự escape)', () => {
    const text = 'Khách bảo "size < 5kg" và <b>gọi lại</b>';

    expect(orderInternalNoteTextSchema.parse(text)).toBe(text);
  });
});

describe('body PATCH internal-note', () => {
  it('chuỗi, chuỗi rỗng và null đều hợp lệ', () => {
    for (const note of ['đã gọi khách', '', null]) {
      expect(updateOrderInternalNoteSchema.safeParse({ note }).success).toBe(
        true,
      );
    }
  });

  it('thiếu `note` bị từ chối: client quên gửi không vô tình xoá ghi chú', () => {
    expect(updateOrderInternalNoteSchema.safeParse({}).success).toBe(false);
    expect(
      updateOrderInternalNoteSchema.safeParse({ note: undefined }).success,
    ).toBe(false);
  });

  it('trường lạ bị bỏ khi parse (không đặt được thứ gì ngoài `note`)', () => {
    const parsed = updateOrderInternalNoteSchema.parse({
      note: 'x',
      status: 'CANCELLED',
      shopId: 'khác',
    });

    expect(Object.keys(parsed)).toEqual(['note']);
  });
});

describe('ghi chú CHỈ ở chi tiết đơn của Seller', () => {
  it('chi tiết đơn của Seller có `internalNote` (chuỗi hoặc null); thiếu trường bị từ chối', () => {
    expect('internalNote' in sellerOrderDetailSchema.shape).toBe(true);
    expect(
      sellerOrderDetailSchema.shape.internalNote.safeParse(null).success,
    ).toBe(true);
    expect(
      sellerOrderDetailSchema.shape.internalNote.safeParse('x').success,
    ).toBe(true);
    expect(
      sellerOrderDetailSchema.shape.internalNote.safeParse(undefined).success,
    ).toBe(false);
  });

  it.each([
    ['danh sách đơn của Seller', sellerOrderListItemSchema.shape],
    ['danh sách đơn của người mua', orderListItemSchema.shape],
    ['chi tiết đơn của người mua', orderDetailSchema.shape],
  ])('%s KHÔNG có trường internalNote', (_name, shape) => {
    expect(Object.keys(shape)).not.toContain('internalNote');
  });
});

describe('khớp với DB', () => {
  const apiRoot = join(__dirname, '..', '..', '..');
  const migrationSql = () => {
    const migrationsDir = join(apiRoot, 'prisma', 'migrations');
    const folder = readdirSync(migrationsDir).find((name) =>
      name.endsWith('_add_order_internal_note'),
    );
    expect(folder).toBeDefined();
    return readFileSync(
      join(migrationsDir, folder as string, 'migration.sql'),
      'utf8',
    );
  };

  it('ORDER_INTERNAL_NOTE_MAX_LENGTH bằng cận trên của CHECK và của VARCHAR (đổi một nơi mà quên nơi kia là test đỏ)', () => {
    const check =
      /char_length\("internal_note"\)\s+BETWEEN\s+1\s+AND\s+(\d+)/.exec(
        migrationSql(),
      );
    const column = /"internal_note"\s+VARCHAR\((\d+)\)/.exec(migrationSql());
    const prisma = readFileSync(
      join(apiRoot, 'prisma', 'schema.prisma'),
      'utf8',
    );
    const model =
      /internalNote\s+String\?\s+@map\("internal_note"\)\s+@db\.VarChar\((\d+)\)/.exec(
        prisma,
      );

    expect(Number(check?.[1])).toBe(ORDER_INTERNAL_NOTE_MAX_LENGTH);
    expect(Number(column?.[1])).toBe(ORDER_INTERNAL_NOTE_MAX_LENGTH);
    expect(Number(model?.[1])).toBe(ORDER_INTERNAL_NOTE_MAX_LENGTH);
  });

  it('migration không backfill (đơn cũ giữ cột NULL)', () => {
    expect(migrationSql()).not.toMatch(/\b(UPDATE|INSERT)\b/i);
  });
});
