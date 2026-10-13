import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, relative, resolve, sep } from 'path';
import { describe, expect, it } from 'vitest';

// Bảo vệ ranh giới module bằng test, không chỉ bằng kỷ luật (Week7.md 1.14, 3.1
// — bản đối chiếu FE của apps/api/src/module-boundaries.spec.ts). Cross-import
// giữa 2 module nghiệp vụ CHỈ được qua barrel `@/modules/<x>` (rules/general.md
// mục 1) — đọc mã nguồn (không thêm thư viện) và fail khi:
//   1. import SÂU vào file nội bộ của module khác (`@/modules/<x>/...` thay vì
//      đúng `@/modules/<x>`) — kể cả từ shared/;
//   2. `modules/cart` import `modules/checkout` (kể cả qua barrel) — nút thanh
//      toán ở /cart chỉ là <Link> tới /checkout (Week7.md 1.14);
//   3. `modules/order` import `modules/checkout`/`modules/cart` (kể cả qua
//      barrel) — nút "Thanh toán lại" gọi `POST /checkout/groups/:groupId/pay`
//      bằng service riêng của `order`, hoặc ghép ở page.tsx (Week8.md 3.0);
//   4. `modules/review` import `product`/`order`/`cart`/`checkout`/`voucher` (kể
//      cả qua barrel) — `product` (trang chi tiết) và `order` (form viết đánh
//      giá ở chi tiết đơn) import barrel `review`, cấm chiều ngược lại để đồ
//      thị không có vòng (Week9.md 3.0; BE có luật tương ứng ở
//      apps/api/src/module-boundaries.spec.ts). `order` → `product` vẫn được
//      phép: chỉ để dùng lại `formatPrice` qua barrel, còn link sản phẩm dựng
//      từ `productSlug` BE trả sẵn.

const SRC_ROOT = resolve(__dirname, '..', '..'); // apps/web/src

// module (khoá) KHÔNG được import module (giá trị) — kể cả qua barrel.
export const FORBIDDEN_MODULE_IMPORTS: Record<string, string[]> = {
  cart: ['checkout'],
  order: ['checkout', 'cart'],
  review: ['product', 'order', 'cart', 'checkout', 'voucher'],
};

const BARREL_ONLY_NAMES = new Set(['index', 'index.ts', 'index.tsx']);

export interface SourceFile {
  path: string; // tương đối so với src/, dùng dấu '/'
  content: string;
}

function extractImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const staticImport =
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[^'";]*?from\s+['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(staticImport)) specifiers.push(m[1]);
  const sideEffectImport = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(sideEffectImport)) specifiers.push(m[1]);
  const dynamicOrRequire = /(?:\brequire|\bimport)\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of content.matchAll(dynamicOrRequire)) specifiers.push(m[1]);
  return specifiers;
}

// Trả path (tương đối src/, không đuôi) của specifier nếu là import nội bộ
// (alias '@/...' hoặc relative './'/'../'); null nếu là package ngoài
// ('@ecommerce/types', 'react'...).
function resolveInternal(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) {
    const abs = resolve(SRC_ROOT, dirname(fromFile), specifier);
    return relative(SRC_ROOT, abs).split(sep).join('/');
  }
  return null;
}

export function findViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];

  for (const file of files) {
    const fromModule = /^modules\/([^/]+)\//.exec(file.path)?.[1];

    for (const specifier of extractImportSpecifiers(file.content)) {
      const target = resolveInternal(file.path, specifier);
      if (!target) continue;

      const toMatch = /^modules\/([^/]+)(?:\/(.+))?$/.exec(target);
      if (!toMatch) continue;
      const [, toModule, toRestRaw] = toMatch;
      const toRest = toRestRaw && !BARREL_ONLY_NAMES.has(toRestRaw) ? toRestRaw : undefined;

      if (fromModule === toModule) continue; // import nội bộ chính module đó — luôn hợp lệ

      if (toRest) {
        violations.push(
          `${file.path}: import sâu vào modules/${toModule}/${toRest} (${specifier}) — chỉ được import qua barrel @/modules/${toModule}`,
        );
        continue;
      }

      // Barrel import (module root) — vẫn có thể bị cấm theo cặp module cụ thể.
      if (fromModule && FORBIDDEN_MODULE_IMPORTS[fromModule]?.includes(toModule)) {
        violations.push(
          `${file.path}: module '${fromModule}' không được phụ thuộc module '${toModule}' (${specifier})`,
        );
      }
    }
  }

  return violations;
}

function collectSourceFiles(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const name of readdirSync(dir)) {
    const abs = resolve(dir, name);
    if (statSync(abs).isDirectory()) {
      out.push(...collectSourceFiles(abs));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push({
        path: relative(SRC_ROOT, abs).split(sep).join('/'),
        content: readFileSync(abs, 'utf8'),
      });
    }
  }
  return out;
}

describe('module boundaries (FE)', () => {
  it('mã nguồn hiện tại không vi phạm ranh giới module', () => {
    const files = [
      ...collectSourceFiles(resolve(SRC_ROOT, 'modules')),
      ...collectSourceFiles(resolve(SRC_ROOT, 'shared')),
    ];
    expect(files.length).toBeGreaterThan(0);
    expect(findViolations(files)).toEqual([]);
  });

  describe('bộ kiểm tra bắt được vi phạm (fixture giả)', () => {
    const file = (path: string, content: string): SourceFile => ({ path, content });

    it('bắt import sâu vào file nội bộ của module khác', () => {
      const v = findViolations([
        file('modules/product/a.ts', "import { X } from '@/modules/cart/hooks/useCart';"),
      ]);
      expect(v).toHaveLength(1);
      expect(v[0]).toContain('import sâu vào modules/cart/hooks/useCart');
    });

    it('cho phép import barrel (@/modules/<x>) của module khác', () => {
      const v = findViolations([
        file('modules/product/a.ts', "import { useCart } from '@/modules/cart';"),
      ]);
      expect(v).toEqual([]);
    });

    it('cấm modules/cart import modules/checkout, kể cả qua barrel', () => {
      const v = findViolations([
        file('modules/cart/a.ts', "import { usePlaceOrder } from '@/modules/checkout';"),
      ]);
      expect(v).toHaveLength(1);
      expect(v[0]).toContain("'cart' không được phụ thuộc module 'checkout'");
    });

    it('cấm modules/order import modules/checkout hoặc modules/cart, kể cả qua barrel', () => {
      const v = findViolations([
        file('modules/order/a.ts', "import { useRetryPayment } from '@/modules/checkout';"),
        file('modules/order/b.ts', "import { useCart } from '@/modules/cart';"),
      ]);
      expect(v).toHaveLength(2);
      expect(v[0]).toContain("'order' không được phụ thuộc module 'checkout'");
      expect(v[1]).toContain("'order' không được phụ thuộc module 'cart'");
    });

    it('cấm modules/review import product/order/cart/checkout/voucher, kể cả qua barrel', () => {
      const v = findViolations([
        file('modules/review/a.ts', "import { formatPrice } from '@/modules/product';"),
        file('modules/review/b.ts', "import { useOrder } from '@/modules/order';"),
        file('modules/review/c.ts', "import { useCart } from '@/modules/cart';"),
        file('modules/review/d.ts', "import { usePlaceOrder } from '@/modules/checkout';"),
        file('modules/review/e.ts', "import { useVouchers } from '@/modules/voucher';"),
      ]);
      expect(v).toHaveLength(5);
      expect(v[0]).toContain("'review' không được phụ thuộc module 'product'");
      expect(v[1]).toContain("'review' không được phụ thuộc module 'order'");
      expect(v[2]).toContain("'review' không được phụ thuộc module 'cart'");
      expect(v[3]).toContain("'review' không được phụ thuộc module 'checkout'");
      expect(v[4]).toContain("'review' không được phụ thuộc module 'voucher'");
    });

    it('cho phép product/order import barrel modules/review, cấm import sâu', () => {
      const ok = findViolations([
        file('modules/product/a.ts', "import { ProductReviewList } from '@/modules/review';"),
        file('modules/order/a.ts', "import { ReviewSheet } from '@/modules/review';"),
      ]);
      expect(ok).toEqual([]);

      const deep = findViolations([
        file(
          'modules/order/b.ts',
          "import { ReviewForm } from '@/modules/review/components/ReviewForm';",
        ),
      ]);
      expect(deep).toHaveLength(1);
      expect(deep[0]).toContain('import sâu vào modules/review/components/ReviewForm');
    });

    it('cho phép modules/review import auth/shop qua barrel và @ecommerce/types', () => {
      const v = findViolations([
        file(
          'modules/review/a.ts',
          "import { useAuthStore } from '@/modules/auth';\nimport type { Review } from '@ecommerce/types';",
        ),
      ]);
      expect(v).toEqual([]);
    });

    it('modules/order vẫn được import formatPrice từ barrel modules/product', () => {
      const v = findViolations([
        file('modules/order/OrderItemRow.tsx', "import { formatPrice } from '@/modules/product';"),
      ]);
      expect(v).toEqual([]);
    });

    it('cho phép module khác (admin, product...) import barrel modules/order', () => {
      const v = findViolations([
        file('modules/admin/a.ts', "import type { OrderStatus } from '@/modules/order';"),
        file('modules/checkout/a.ts', "import { X } from '@/modules/order';"),
      ]);
      expect(v).toEqual([]);
    });

    it('bỏ qua import nội bộ trong cùng module và package ngoài', () => {
      const v = findViolations([
        file(
          'modules/cart/a.ts',
          "import { X } from './services/cart.service';\nimport { useQuery } from '@tanstack/react-query';\nimport type { CartView } from '@ecommerce/types';",
        ),
      ]);
      expect(v).toEqual([]);
    });

    it('bắt cả require()/import() động và import nhiều dòng', () => {
      const v = findViolations([
        file(
          'modules/product/a.ts',
          "const m = require('@/modules/checkout/services/checkout.service');",
        ),
        file(
          'modules/product/b.ts',
          "import {\n  useCart,\n} from '@/modules/cart/hooks/useCart';",
        ),
      ]);
      expect(v).toHaveLength(2);
    });

    it('shared/ import sâu vào module khác cũng bị bắt', () => {
      const v = findViolations([
        file('shared/components/X.tsx', "import { useCart } from '@/modules/cart/hooks/useCart';"),
      ]);
      expect(v).toHaveLength(1);
    });
  });
});
