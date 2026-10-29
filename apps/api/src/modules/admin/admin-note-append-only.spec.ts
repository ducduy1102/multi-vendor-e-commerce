import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

// Ghi chú nội bộ của Admin là CHỈ THÊM (Week11.md 4.3, D15): không có UPDATE/DELETE nào trên `admin_notes` trong mã chạy
// thật. Test này đọc mã nguồn (cùng cách `shared/audit/admin-audit-append-only.spec.ts`, không thêm thư viện) và fail khi có
// dòng nào sửa hay xoá bảng đó. Test, fixture dọn dữ liệu (`shared/testing/`) và `*.int-spec.ts` được phép xoá hàng do chính
// chúng tạo; mã còn lại (service, controller, job, seed) thì không.
//
// Lưu ý: cờ dọn dẹp `allow_audit_cleanup` dùng chung với nhật ký quản trị nên đã bị `admin-audit-append-only.spec.ts` cấm ở mã
// chạy thật — test này chỉ bổ sung các mẫu riêng của bảng ghi chú.
const API_ROOT = join(__dirname, '..', '..', '..');

interface ScannedFile {
  path: string; // tương đối so với apps/api, dùng dấu '/'
  content: string;
}

const FORBIDDEN: [string, RegExp][] = [
  [
    'Prisma sửa/xoá trên adminNote',
    /\badminNote["']?\]?\s*\??\.\s*(update|updateMany|upsert|delete|deleteMany)\b/,
  ],
  [
    'SQL UPDATE/DELETE/TRUNCATE trên admin_notes',
    /\b(UPDATE|DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\s+(ONLY\s+)?"?(public"?\."?)?admin_notes\b/i,
  ],
  [
    'tắt/gỡ trigger của admin_notes',
    /\b(DROP|DISABLE)\s+TRIGGER\b[^;]*admin_notes|\bALTER\s+TABLE\s+(ONLY\s+)?"?(public"?\."?)?admin_notes"?\s+(DISABLE|ENABLE|DROP)\b/i,
  ],
];

export function findAdminNoteViolations(files: ScannedFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const [label, pattern] of FORBIDDEN) {
      const match = pattern.exec(file.content);
      if (match) violations.push(`${file.path}: ${label} (“${match[0]}”)`);
    }
  }
  return violations;
}

const isTestFile = (path: string) =>
  path.endsWith('.spec.ts') ||
  path.endsWith('.int-spec.ts') ||
  path.endsWith('.e2e-spec.ts') ||
  path.includes('/shared/testing/');

function collect(dir: string): ScannedFile[] {
  const out: ScannedFile[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      if (name === 'migrations') continue; // SQL lịch sử, không phải mã chạy
      out.push(...collect(abs));
    } else if (name.endsWith('.ts')) {
      const path = relative(API_ROOT, abs).split(sep).join('/');
      if (!isTestFile(`/${path}`)) {
        out.push({ path, content: readFileSync(abs, 'utf8') });
      }
    }
  }
  return out;
}

describe('ghi chú nội bộ của Admin chỉ thêm', () => {
  it('mã nguồn chạy thật (src/ và prisma/*.ts, không tính test) không sửa hay xoá admin_notes', () => {
    const files = [
      ...collect(join(API_ROOT, 'src')),
      ...collect(join(API_ROOT, 'prisma')),
    ];

    // Chặn kết quả xanh giả do quét nhầm thư mục: phải thấy chính service ghi chú và nhiều tệp khác.
    expect(files.length).toBeGreaterThan(100);
    expect(files.map((f) => f.path)).toContain(
      'src/modules/admin/admin-notes.service.ts',
    );
    expect(findAdminNoteViolations(files)).toEqual([]);
  });

  describe('bộ kiểm tra bắt được vi phạm (fixture giả)', () => {
    const file = (content: string): ScannedFile => ({ path: 'x.ts', content });

    it.each([
      ['tx.adminNote.update({ where: { id }, data: {} })'],
      ['this.prisma.adminNote.updateMany({ data: {} })'],
      ['prisma.adminNote.upsert({})'],
      ['prisma.adminNote.delete({ where: { id } })'],
      ['prisma["adminNote"].deleteMany()'],
      ['await prisma.$executeRaw`UPDATE admin_notes SET content = x`'],
      ['await prisma.$executeRawUnsafe(\'DELETE FROM "admin_notes"\')'],
      ['TRUNCATE TABLE admin_notes'],
      ['ALTER TABLE admin_notes DISABLE TRIGGER ALL'],
      ['DROP TRIGGER admin_notes_no_update_delete ON admin_notes'],
    ])('bắt: %s', (content) => {
      expect(findAdminNoteViolations([file(content)])).toHaveLength(1);
    });

    it.each([
      ['this.prisma.adminNote.create({ data })'],
      ['this.prisma.adminNote.findMany({ where })'],
      ['this.prisma.adminNote.count({ where })'],
      ['// không có UPDATE nào trên bảng này'],
      ['const admin_notes_count = 1'],
    ])('không báo nhầm: %s', (content) => {
      expect(findAdminNoteViolations([file(content)])).toEqual([]);
    });
  });
});
