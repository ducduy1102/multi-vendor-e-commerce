import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';

// Bảo vệ ranh giới module bằng test thay vì chỉ bằng kỷ luật (Week7.md 1.14).
// Đọc mã nguồn (không thêm thư viện) và fail khi vi phạm:
//   1. chiều phụ thuộc bị cấm giữa các module nghiệp vụ (đồ thị không có vòng);
//   2. `shared/` import từ `modules/`;
//   3. module import FILE NỘI BỘ của module khác (chỉ được `*.module` / `*.service`).

const SRC_ROOT = __dirname;

// module (khoá) KHÔNG được import các module (giá trị).
export const FORBIDDEN_DEPENDENCIES: Record<string, string[]> = {
  voucher: ['cart', 'checkout', 'order'],
  product: ['cart', 'checkout', 'order'],
  order: ['checkout', 'cart'],
  cart: ['checkout', 'order'],
};

// Ngoại lệ có chủ đích cho luật 2 & 3 — chỉ `import type` (bị xoá lúc biên dịch, không tạo
// phụ thuộc lúc chạy). Vi phạm có từ Tuần 2-6, liệt kê minh bạch thay vì nới lỏng luật.
export const TYPE_ONLY_EXCEPTIONS = ['modules/auth/types/jwt-payload.type'];

const ALLOWED_CROSS_MODULE_FILES = /^[a-z-]+\.(module|service)$/;

export interface SourceFile {
  path: string; // tương đối so với src/, dùng dấu '/'
  content: string;
}

interface ImportRef {
  specifier: string;
  isTypeOnly: boolean;
}

function extractImports(content: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const staticImport =
    /(?:^|\n)\s*(import|export)\s+(type\s+)?[^'";]*?from\s+['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(staticImport)) {
    refs.push({ specifier: m[3], isTypeOnly: m[2] !== undefined });
  }
  const sideEffectImport = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(sideEffectImport)) {
    refs.push({ specifier: m[1], isTypeOnly: false });
  }
  const dynamicOrRequire = /(?:\brequire|\bimport)\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of content.matchAll(dynamicOrRequire)) {
    refs.push({ specifier: m[1], isTypeOnly: false });
  }
  return refs;
}

// Trả path của file được import, tương đối so với src/ (không đuôi), hoặc null nếu là package ngoài.
function resolveInternal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const abs = resolve(SRC_ROOT, dirname(fromFile), specifier);
  return relative(SRC_ROOT, abs).split(sep).join('/');
}

export function findViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];

  for (const file of files) {
    const fromModule = /^modules\/([^/]+)\//.exec(file.path)?.[1];
    const fromShared = file.path.startsWith('shared/');
    if (!fromModule && !fromShared) continue;

    for (const ref of extractImports(file.content)) {
      const target = resolveInternal(file.path, ref.specifier);
      if (!target) continue;
      const toParts = /^modules\/([^/]+)\/(.+)$/.exec(target);
      if (!toParts) continue;
      const [, toModule, toRest] = toParts;
      const isException =
        ref.isTypeOnly && TYPE_ONLY_EXCEPTIONS.includes(target);

      if (fromShared) {
        if (!isException) {
          violations.push(
            `${file.path}: shared/ không được import từ modules/ (${ref.specifier})`,
          );
        }
        continue;
      }

      if (toModule === fromModule) continue;

      if (FORBIDDEN_DEPENDENCIES[fromModule!]?.includes(toModule)) {
        violations.push(
          `${file.path}: module '${fromModule}' không được phụ thuộc module '${toModule}' (${ref.specifier})`,
        );
        continue;
      }

      const isPublicSurface =
        ALLOWED_CROSS_MODULE_FILES.test(toRest) && !toRest.includes('/');
      if (!isPublicSurface && !isException) {
        violations.push(
          `${file.path}: import file nội bộ của module '${toModule}' (${ref.specifier}) — chỉ được import *.module/*.service`,
        );
      }
    }
  }

  return violations;
}

function collectSourceFiles(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      out.push(...collectSourceFiles(abs));
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      out.push({
        path: relative(SRC_ROOT, abs).split(sep).join('/'),
        content: readFileSync(abs, 'utf8'),
      });
    }
  }
  return out;
}

describe('module boundaries', () => {
  it('mã nguồn hiện tại không vi phạm ranh giới module', () => {
    const files = [
      ...collectSourceFiles(join(SRC_ROOT, 'modules')),
      ...collectSourceFiles(join(SRC_ROOT, 'shared')),
    ];
    expect(files.length).toBeGreaterThan(0);
    expect(findViolations(files)).toEqual([]);
  });

  describe('bộ kiểm tra bắt được vi phạm (fixture giả)', () => {
    const file = (path: string, content: string): SourceFile => ({
      path,
      content,
    });

    it('bắt phụ thuộc bị cấm (order → checkout, voucher → cart)', () => {
      const v = findViolations([
        file(
          'modules/order/a.ts',
          "import { X } from '../checkout/checkout.service';",
        ),
        file(
          'modules/voucher/b.ts',
          "import { Y } from '../cart/cart.service';",
        ),
      ]);
      expect(v).toHaveLength(2);
      expect(v[0]).toContain("'order' không được phụ thuộc module 'checkout'");
      expect(v[1]).toContain("'voucher' không được phụ thuộc module 'cart'");
    });

    it('bắt import file nội bộ của module khác, cho phép *.module/*.service', () => {
      const v = findViolations([
        file(
          'modules/cart/a.ts',
          "import { A } from '../voucher/voucher-discount';",
        ),
        file(
          'modules/cart/b.ts',
          "import { B } from '../voucher/voucher.service';",
        ),
        file(
          'modules/cart/c.ts',
          "import { C } from '../voucher/voucher.module';",
        ),
      ]);
      expect(v).toHaveLength(1);
      expect(v[0]).toContain('modules/cart/a.ts');
    });

    it('bắt shared/ import từ modules/', () => {
      const v = findViolations([
        file(
          'shared/x.ts',
          "import { S } from '../modules/shop/shop.service';",
        ),
      ]);
      expect(v).toHaveLength(1);
      expect(v[0]).toContain('shared/ không được import từ modules/');
    });

    it('chỉ cho phép ngoại lệ khi là import type', () => {
      const ok = findViolations([
        file(
          'shared/x.ts',
          "import type { U } from '../modules/auth/types/jwt-payload.type';",
        ),
        file(
          'modules/cart/a.ts',
          "import type { U } from '../auth/types/jwt-payload.type';",
        ),
      ]);
      expect(ok).toEqual([]);

      const bad = findViolations([
        file(
          'shared/x.ts',
          "import { U } from '../modules/auth/types/jwt-payload.type';",
        ),
      ]);
      expect(bad).toHaveLength(1);
    });

    it('bắt cả require()/import() động và import nhiều dòng', () => {
      const v = findViolations([
        file(
          'modules/product/a.ts',
          "const m = require('../order/order.service');",
        ),
        file(
          'modules/product/b.ts',
          "import {\n  A,\n  B,\n} from '../cart/cart.service';",
        ),
      ]);
      expect(v).toHaveLength(2);
    });

    it('bỏ qua import trong cùng module và package ngoài', () => {
      const v = findViolations([
        file(
          'modules/cart/a.ts',
          "import { Z } from './cart-view';\nimport { Injectable } from '@nestjs/common';",
        ),
      ]);
      expect(v).toEqual([]);
    });
  });
});
