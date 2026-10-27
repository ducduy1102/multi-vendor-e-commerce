import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

// Nhật ký quản trị là CHỈ THÊM (Week11.md 2.3, D4): không có UPDATE/DELETE nào trên `admin_audit_logs` trong mã chạy
// thật. Test này đọc mã nguồn (cùng cách module-boundaries.spec.ts, không thêm thư viện) và fail khi có dòng nào sửa
// hay xoá bảng đó. Test, fixture dọn dữ liệu (`shared/testing/`) và `*.int-spec.ts` được phép xoá hàng do chính chúng
// tạo; mã còn lại (service, controller, job, seed) thì không.
const API_ROOT = join(__dirname, '..', '..', '..');

interface ScannedFile {
  path: string; // tương đối so với apps/api, dùng dấu '/'
  content: string;
}

const FORBIDDEN: [string, RegExp][] = [
  [
    'Prisma sửa/xoá trên adminAuditLog',
    /\badminAuditLog["']?\]?\s*\??\.\s*(update|updateMany|upsert|delete|deleteMany)\b/,
  ],
  [
    'SQL UPDATE/DELETE/TRUNCATE trên admin_audit_logs',
    /\b(UPDATE|DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\s+(ONLY\s+)?"?(public"?\."?)?admin_audit_logs\b/i,
  ],
  // Trigger ở DB (migration add_admin_audit_logs) là lớp chặn thứ hai. Mã chạy thật không được mở lối thoát của nó (cờ chỉ
  // dành cho test dọn dữ liệu, `shared/testing/admin-audit-cleanup.ts`) cũng không được tắt/gỡ nó.
  ['cờ dọn dẹp nhật ký (chỉ dành cho test)', /allow_audit_cleanup/],
  [
    'tắt/gỡ trigger của admin_audit_logs',
    /\b(DROP|DISABLE)\s+TRIGGER\b[^;]*admin_audit_logs|\bALTER\s+TABLE\s+(ONLY\s+)?"?(public"?\."?)?admin_audit_logs"?\s+(DISABLE|ENABLE|DROP)\b/i,
  ],
  [
    'session_replication_role (vô hiệu hoá mọi trigger của phiên)',
    /session_replication_role/i,
  ],
];

export function findAppendOnlyViolations(files: ScannedFile[]): string[] {
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

describe('nhật ký quản trị chỉ thêm', () => {
  it('mã nguồn chạy thật (src/ và prisma/*.ts, không tính test) không sửa hay xoá admin_audit_logs', () => {
    const files = [
      ...collect(join(API_ROOT, 'src')),
      ...collect(join(API_ROOT, 'prisma')),
    ];

    // Chặn kết quả xanh giả do quét nhầm thư mục: phải thấy chính service ghi nhật ký và nhiều tệp khác.
    expect(files.length).toBeGreaterThan(100);
    expect(files.map((f) => f.path)).toContain(
      'src/shared/audit/admin-audit.service.ts',
    );
    expect(findAppendOnlyViolations(files)).toEqual([]);
  });

  describe('bộ kiểm tra bắt được vi phạm (fixture giả)', () => {
    const file = (content: string): ScannedFile => ({ path: 'x.ts', content });

    it.each([
      ['tx.adminAuditLog.update({ where: { id }, data: {} })'],
      ['this.prisma.adminAuditLog.updateMany({ data: {} })'],
      ['await tx.adminAuditLog.upsert({})'],
      ['prisma.adminAuditLog.delete({ where: { id } })'],
      ['prisma.adminAuditLog.deleteMany()'],
      ["tx['adminAuditLog'].delete({})"],
      ['tx.adminAuditLog?.deleteMany({})'],
      ['const { adminAuditLog } = tx;\nadminAuditLog\n  .deleteMany({});'],
      ['await tx.$executeRaw`UPDATE admin_audit_logs SET reason = NULL`'],
      ['await tx.$executeRawUnsafe(\'UPDATE "admin_audit_logs" SET x = 1\')'],
      ['await tx.$executeRaw`DELETE FROM admin_audit_logs WHERE true`'],
      ['await tx.$executeRaw`delete from public."admin_audit_logs"`'],
      ['await tx.$executeRaw`TRUNCATE TABLE admin_audit_logs`'],
      ['await tx.$executeRaw`TRUNCATE admin_audit_logs`'],
      [
        "await tx.$queryRaw`SELECT set_config('app.allow_audit_cleanup', 'on', true)`",
      ],
      [
        'await tx.$executeRaw`ALTER TABLE admin_audit_logs DISABLE TRIGGER ALL`',
      ],
      [
        'await tx.$executeRaw`ALTER TABLE "admin_audit_logs" DISABLE TRIGGER admin_audit_logs_no_update_delete`',
      ],
      [
        'await tx.$executeRaw`DROP TRIGGER admin_audit_logs_no_truncate ON admin_audit_logs`',
      ],
      ['await tx.$executeRaw`SET session_replication_role = replica`'],
    ])('bắt: %s', (content) => {
      expect(findAppendOnlyViolations([file(content)])).toHaveLength(1);
    });

    it.each([
      ['tx.adminAuditLog.create({ data })'],
      ['prisma.adminAuditLog.findMany({ where })'],
      ['prisma.adminAuditLog.count()'],
      ['await tx.$queryRaw`SELECT * FROM admin_audit_logs`'],
      ['await tx.$executeRaw`INSERT INTO admin_audit_logs (id) VALUES (1)`'],
      ['notification.update({ where })'],
      ['await tx.$executeRaw`UPDATE admin_audit_logs_archive SET x = 1`'],
      ['await tx.$executeRaw`ALTER TABLE notifications DISABLE TRIGGER ALL`'],
      ['await tx.$executeRaw`ALTER TABLE admin_audit_logs ADD COLUMN x text`'],
    ])('không bắt nhầm: %s', (content) => {
      expect(findAppendOnlyViolations([file(content)])).toEqual([]);
    });
  });
});
