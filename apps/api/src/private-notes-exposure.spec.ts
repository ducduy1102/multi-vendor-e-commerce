import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

// Hai loại ghi chú nội bộ (Week11.md 4.3, 4.4) chỉ được ĐỌC ở đúng một nơi của mã chạy thật, để không có `select`/`include` nào ở route
// khác vô tình đưa chúng vào response của người mua, Admin khác hay khách:
//   - `internalNote` (ghi chú của SHOP trên đơn): chỉ chi tiết đơn của Seller (`sellerDetailSelect` + hàm dựng response) và service ghi;
//   - `adminNote` (ghi chú của ADMIN về người dùng/shop): chỉ `AdminNotesService`.
// Test tích hợp đã kiểm response thật của nhiều route; test này là lưới thứ hai ở TẦNG MÃ NGUỒN — thêm một chỗ đọc mới thì test đỏ để
// người viết phải dừng lại hỏi "ghi chú này có được lộ ra cho người xem route đó không?". Cùng cách `admin-audit-append-only.spec.ts`,
// `module-boundaries.spec.ts`: đọc mã nguồn, không thêm thư viện. Test, fixture dọn dữ liệu (`shared/testing/`) và `*.int-spec.ts` được
// phép nhắc tới chúng.
const SRC_ROOT = __dirname;

interface ScannedFile {
  path: string; // tương đối so với apps/api/src, dùng dấu '/'
  content: string;
}

export interface ExposureRule {
  label: string;
  pattern: RegExp;
  // File (tương đối so với src) được phép nhắc tới `pattern`.
  allowed: readonly string[];
}

export const EXPOSURE_RULES: readonly ExposureRule[] = [
  {
    label: 'internalNote (ghi chú nội bộ của shop trên đơn)',
    pattern: /\binternalNote\b/,
    allowed: [
      'modules/order/order-query.service.ts',
      'modules/order/order-internal-note.service.ts',
      'modules/order/seller-order.controller.ts', // ví dụ Swagger
    ],
  },
  {
    label: 'adminNote (ghi chú nội bộ của Admin)',
    pattern: /\badminNote\b/,
    allowed: ['modules/admin/admin-notes.service.ts'],
  },
];

export function findExposureViolations(files: ScannedFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const rule of EXPOSURE_RULES) {
      if (
        rule.pattern.test(file.content) &&
        !rule.allowed.includes(file.path)
      ) {
        violations.push(
          `${file.path}: nhắc tới ${rule.label} ngoài danh sách cho phép`,
        );
      }
    }
  }
  return violations;
}

// Trong order-query.service.ts, `internalNote` chỉ được nằm trong `sellerDetailSelect`: một select khác (danh sách của Seller, danh sách /
// chi tiết của người mua, hàng chờ yêu cầu) mà có nó là rò rỉ. Cắt khối `sellerDetailSelect` ra rồi kiểm phần còn lại không còn
// `internalNote: true`, và hàm dựng response chỉ có đúng một chỗ gán.
export function findOrderQueryViolations(content: string): string[] {
  const violations: string[] = [];
  const start = content.indexOf('const sellerDetailSelect = {');
  const endMarker = '} satisfies Prisma.OrderSelect;';
  const end = start === -1 ? -1 : content.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    return [
      'không tìm thấy khối sellerDetailSelect (đổi tên? cập nhật test này cùng lúc)',
    ];
  }
  const block = content.slice(start, end + endMarker.length);
  const rest = content.slice(0, start) + content.slice(end + endMarker.length);

  if (!/\binternalNote:\s*true\b/.test(block)) {
    violations.push('sellerDetailSelect không còn chọn internalNote');
  }
  if (/\binternalNote:\s*true\b/.test(rest)) {
    violations.push(
      'có select khác ngoài sellerDetailSelect chọn internalNote',
    );
  }
  const assignments =
    rest.match(/\binternalNote:\s*order\.internalNote\b/g) ?? [];
  if (assignments.length !== 1) {
    violations.push(
      `internalNote được gán vào response ${assignments.length} lần (mong đợi đúng 1: chi tiết của Seller)`,
    );
  }
  return violations;
}

const isTestFile = (path: string) =>
  path.endsWith('.spec.ts') ||
  path.endsWith('.int-spec.ts') ||
  path.endsWith('.e2e-spec.ts') ||
  path.includes('shared/testing/');

function collect(dir: string): ScannedFile[] {
  const out: ScannedFile[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      out.push(...collect(abs));
    } else if (name.endsWith('.ts')) {
      const path = relative(SRC_ROOT, abs).split(sep).join('/');
      if (!isTestFile(path))
        out.push({ path, content: readFileSync(abs, 'utf8') });
    }
  }
  return out;
}

describe('ghi chú nội bộ chỉ được đọc ở đúng nơi của nó', () => {
  const files = collect(SRC_ROOT);

  it('mã chạy thật chỉ nhắc tới internalNote / adminNote ở các file được phép', () => {
    // Chặn kết quả xanh giả do quét nhầm thư mục: phải thấy nhiều file và chính các file được phép.
    expect(files.length).toBeGreaterThan(100);
    const paths = files.map((f) => f.path);
    for (const rule of EXPOSURE_RULES) {
      for (const allowed of rule.allowed) expect(paths).toContain(allowed);
    }
    expect(findExposureViolations(files)).toEqual([]);
  });

  it('order-query.service.ts: internalNote chỉ nằm trong sellerDetailSelect và chỉ gán vào MỘT response', () => {
    const content =
      files.find((f) => f.path === 'modules/order/order-query.service.ts')
        ?.content ?? '';

    expect(findOrderQueryViolations(content)).toEqual([]);
  });

  describe('bộ kiểm tra bắt được vi phạm (fixture giả)', () => {
    const file = (path: string, content: string): ScannedFile => ({
      path,
      content,
    });

    it.each([
      [
        'modules/order/buyer-order.controller.ts',
        'select: { internalNote: true }',
      ],
      ['modules/chat/chat.service.ts', 'order.internalNote'],
      ['modules/admin/admin-refund.controller.ts', 'x.internalNote'],
      ['modules/admin/admin.service.ts', 'this.prisma.adminNote.findMany({})'],
      ['modules/shop/shop.service.ts', 'prisma.adminNote.count()'],
    ])('bắt: %s', (path, content) => {
      expect(findExposureViolations([file(path, content)])).toHaveLength(1);
    });

    it('không báo nhầm khi nằm đúng file được phép hoặc chỉ là tên gần giống', () => {
      expect(
        findExposureViolations([
          file('modules/order/order-query.service.ts', 'internalNote: true'),
          file(
            'modules/admin/admin-notes.service.ts',
            'this.prisma.adminNote.create({})',
          ),
          file(
            'modules/admin/dto/create-admin-note.dto.ts',
            'createAdminNoteSchema, adminNoteListQuerySchema',
          ),
          file(
            'modules/x.ts',
            'const buyerNote = 1; // adminNotes, internalNotes',
          ),
        ]),
      ).toEqual([]);
    });

    const select = (body: string) =>
      `const listSelect = {\n  buyerNote: true,\n${body}} satisfies Prisma.OrderSelect;\n` +
      `const sellerDetailSelect = {\n  carrier: true,\n  internalNote: true,\n} satisfies Prisma.OrderSelect;\n` +
      `function toSeller(order) { return { internalNote: order.internalNote }; }\n`;

    it('order-query: select đúng chỗ thì sạch', () => {
      expect(findOrderQueryViolations(select(''))).toEqual([]);
    });

    it('order-query: bắt internalNote lọt vào select khác (vd danh sách / chi tiết của người mua)', () => {
      expect(
        findOrderQueryViolations(select('  internalNote: true,\n')),
      ).toEqual(['có select khác ngoài sellerDetailSelect chọn internalNote']);
    });

    it('order-query: bắt gán internalNote vào response thứ hai', () => {
      const content =
        select('') +
        'function toBuyer(order) { return { internalNote: order.internalNote }; }\n';

      expect(findOrderQueryViolations(content)).toEqual([
        'internalNote được gán vào response 2 lần (mong đợi đúng 1: chi tiết của Seller)',
      ]);
    });

    it('order-query: bắt khi sellerDetailSelect không còn chọn internalNote hoặc bị đổi tên', () => {
      expect(
        findOrderQueryViolations(
          select('').replace('  internalNote: true,\n', ''),
        ),
      ).toContain('sellerDetailSelect không còn chọn internalNote');
      expect(findOrderQueryViolations('const other = {};')).toHaveLength(1);
    });
  });
});
