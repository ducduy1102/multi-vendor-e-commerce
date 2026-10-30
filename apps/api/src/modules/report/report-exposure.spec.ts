import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

// Chốt chặn "người bị báo không có route nào thấy người báo" (Week11.md 5.3, D5) ở tầng MÃ NGUỒN. Bảng `reports` mang danh tính người
// báo (`reporter_id`) và ghi chú riêng tư; chỉ module `report` (biên nhận của chính người báo) và `modules/admin` (hàng đợi — chỉ Admin)
// được đọc nó. Nếu một module khác (shop, order, review, product...) đọc bảng này — bằng Prisma delegate, `include`, hay SQL thô —
// thì một route phía chủ shop/tác giả đánh giá có thể vô tình đưa người báo ra. Test đọc mã nguồn và liệt kê mọi chỗ đụng bảng.
// (Bảng cũng không có quan hệ ngược ở `User`/`Shop`/`Review`..., xem report-schemas.spec.ts — nên không có đường `include` nào.)
const SRC_ROOT = join(__dirname, '..', '..');

// Thư mục được phép đụng bảng `reports` trong mã SẢN XUẤT. Mã test (`*.spec.ts`, `*.int-spec.ts`) dựng dữ liệu nên không bị xét.
const ALLOWED_DIRS = ['modules/report/', 'modules/admin/', 'shared/testing/'];

const DELEGATE_ACCESS = /\b(?:prisma|tx|client|db)\.report\b/;
const RAW_SQL_ACCESS = /\b(?:FROM|JOIN|INTO|UPDATE)\s+"?reports"?\b/i;

interface SourceFile {
  path: string;
  content: string;
}

function collect(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      out.push(...collect(abs));
    } else if (name.endsWith('.ts') && !/\.(spec|int-spec)\.ts$/.test(name)) {
      out.push({
        path: relative(SRC_ROOT, abs).split(sep).join('/'),
        content: readFileSync(abs, 'utf8'),
      });
    }
  }
  return out;
}

export function findReportTableAccess(files: SourceFile[]): string[] {
  return files
    .filter((f) => !ALLOWED_DIRS.some((dir) => f.path.startsWith(dir)))
    .filter(
      (f) => DELEGATE_ACCESS.test(f.content) || RAW_SQL_ACCESS.test(f.content),
    )
    .map((f) => f.path);
}

describe('bảng reports chỉ được đọc ở module report và khu Admin', () => {
  it('không có mã sản xuất nào khác đụng bảng (Prisma delegate hay SQL thô)', () => {
    const files = collect(SRC_ROOT);

    expect(files.length).toBeGreaterThan(50);
    expect(findReportTableAccess(files)).toEqual([]);
  });

  it('mã sản xuất của module report CÓ đụng bảng (kiểm quét không rỗng: nó thật sự đọc được chỗ đáng đọc)', () => {
    const files = collect(SRC_ROOT).filter((f) =>
      f.path.startsWith('modules/report/'),
    );

    expect(files.some((f) => DELEGATE_ACCESS.test(f.content))).toBe(true);
  });

  it('bộ kiểm quét này thật sự bắt được chỗ đọc nguy hiểm (kiểm chứng chính nó)', () => {
    const files: SourceFile[] = [
      {
        path: 'modules/shop/shop.service.ts',
        content: 'const r = await this.prisma.report.findMany({});',
      },
      {
        path: 'modules/order/order.service.ts',
        content: 'await tx.$queryRaw`SELECT reporter_id FROM reports`;',
      },
      {
        path: 'modules/review/review.service.ts',
        content: 'include: { user: true }',
      },
      {
        path: 'modules/admin/admin-reports.service.ts',
        content: 'await this.prisma.report.findMany({});',
      },
    ];

    expect(findReportTableAccess(files)).toEqual([
      'modules/shop/shop.service.ts',
      'modules/order/order.service.ts',
    ]);
  });
});
