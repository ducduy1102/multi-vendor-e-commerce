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
//   5. `modules/auth` và `modules/checkout` import `modules/account` (kể cả
//      qua barrel) — `account` ghép UI trên `auth` (`ResendVerificationButton`,
//      `useAuthStore`) và `checkout` (hook địa chỉ, `AddressForm`) qua barrel
//      của chúng, nên cấm chiều ngược lại để đồ thị không có vòng (Week9.md
//      6.0). `account` chỉ có ở FE: phía BE endpoint tài khoản nằm trong `auth`.
//   6. `modules/chat` là LÁ: không import module nghiệp vụ nào và không module
//      nghiệp vụ nào import `chat` (kể cả qua barrel) — nút "Chat với shop"/"Chat
//      với người mua" ghép ở `page.tsx` bằng slot/prop, huy hiệu ở Header ghép từ
//      `shared/` (Week10.md 5.4, 5.5; BE có luật `chat` tương ứng ở
//      apps/api/src/module-boundaries.spec.ts). Đăng xuất dọn hộp chờ gửi
//      (`resetChatOutbox`) cũng do nơi ghép làm, vì chat không thấy `auth`.
//   7. `modules/notification` cũng là LÁ (Week10.md 8.5): không import module nghiệp vụ nào, không import `chat` và
//      ngược lại, không module nào import `notification` (kể cả qua barrel) — chuông, huy hiệu và đồng bộ real-time ghép
//      ở `shared/` (nạp động cho người đã đăng nhập, xem shared/components/lazy-notification.tsx), trang `/notifications`
//      chỉ compose ở page.tsx. BE có luật `notification` tương ứng ở apps/api/src/module-boundaries.spec.ts.
//   8. `modules/appeal` (kháng nghị của shop, Week11.md 4.6) cũng là LÁ: không import module nghiệp vụ nào (kể cả `shop`, nên mục
//      kháng nghị không tự biết trạng thái shop) và không module nào import `appeal` — mục kháng nghị ghép vào `/seller/shop`
//      ở `app/[locale]/seller/shop/_components/SellerShopAppealEntry` qua slot của `ShopDashboardContainer`. Hàng đợi của Admin
//      nằm trong `modules/admin` (không phải `appeal`). BE có luật `appeal` tương ứng ở apps/api/src/module-boundaries.spec.ts.
//   9. `modules/report` (báo cáo vi phạm phía người dùng, Week11.md 5.6) cũng là LÁ: không import module nghiệp vụ nào (kể cả `auth` —
//      nút không tự biết đã đăng nhập chưa — và `shop`/`review`/`chat`) và không module nào import `report`; nút "Báo cáo" ghép ở
//      page.tsx / app/[locale]/_components/ReportEntry (nạp động cho người đã đăng nhập). Hàng đợi của Admin nằm trong `modules/admin`.

const SRC_ROOT = resolve(__dirname, '..', '..'); // apps/web/src

const BUSINESS_MODULES_OTHER_THAN_CHAT = [
  'account',
  'admin',
  'appeal',
  'auth',
  'cart',
  'checkout',
  'order',
  'product',
  'report',
  'review',
  'shop',
  'voucher',
  'wishlist',
];

// module (khoá) KHÔNG được import module (giá trị) — kể cả qua barrel.
export const FORBIDDEN_MODULE_IMPORTS: Record<string, string[]> = {
  account: ['appeal', 'chat', 'notification', 'report'],
  admin: ['appeal', 'chat', 'notification', 'report'],
  // Lá: không import module nào khác (danh sách đã gồm cả chính nó — import nội bộ của module luôn hợp lệ nên không ảnh hưởng).
  appeal: [...BUSINESS_MODULES_OTHER_THAN_CHAT, 'chat', 'notification'],
  auth: ['account', 'appeal', 'chat', 'notification', 'report'],
  cart: ['checkout', 'appeal', 'chat', 'notification', 'report'],
  chat: [...BUSINESS_MODULES_OTHER_THAN_CHAT, 'notification'],
  checkout: ['account', 'appeal', 'chat', 'notification', 'report'],
  notification: [...BUSINESS_MODULES_OTHER_THAN_CHAT, 'chat'],
  order: ['checkout', 'cart', 'appeal', 'chat', 'notification', 'report'],
  product: ['appeal', 'chat', 'notification', 'report'],
  // Lá: không import module nào khác (danh sách đã gồm cả chính nó — import nội bộ của module luôn hợp lệ nên không ảnh hưởng).
  report: [...BUSINESS_MODULES_OTHER_THAN_CHAT, 'chat', 'notification'],
  review: [
    'product',
    'order',
    'cart',
    'checkout',
    'voucher',
    'appeal',
    'chat',
    'notification',
    'report',
  ],
  shop: ['appeal', 'chat', 'notification', 'report'],
  voucher: ['appeal', 'chat', 'notification', 'report'],
  wishlist: ['appeal', 'chat', 'notification', 'report'],
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

    it('cấm modules/auth và modules/checkout import modules/account, kể cả qua barrel', () => {
      const v = findViolations([
        file('modules/auth/a.ts', "import { ProfileForm } from '@/modules/account';"),
        file('modules/checkout/a.ts', "import { AddressBook } from '@/modules/account';"),
      ]);
      expect(v).toHaveLength(2);
      expect(v[0]).toContain("'auth' không được phụ thuộc module 'account'");
      expect(v[1]).toContain("'checkout' không được phụ thuộc module 'account'");
    });

    it('cho phép modules/account import auth/checkout qua barrel, cấm import sâu', () => {
      const ok = findViolations([
        file(
          'modules/account/a.ts',
          "import { ResendVerificationButton, useAuthStore } from '@/modules/auth';\nimport { useAddresses, useDeleteAddress } from '@/modules/checkout';",
        ),
      ]);
      expect(ok).toEqual([]);

      const deep = findViolations([
        file(
          'modules/account/b.ts',
          "import { useDeleteAddress } from '@/modules/checkout/hooks/useDeleteAddress';",
        ),
        file(
          'modules/account/c.ts',
          "import { useAuthStore } from '@/modules/auth/store/auth.store';",
        ),
      ]);
      expect(deep).toHaveLength(2);
      expect(deep[0]).toContain('import sâu vào modules/checkout/hooks/useDeleteAddress');
      expect(deep[1]).toContain('import sâu vào modules/auth/store/auth.store');
    });

    it('modules/chat là lá: cấm import mọi module nghiệp vụ, kể cả qua barrel', () => {
      const v = findViolations([
        file('modules/chat/a.ts', "import { useAuthStore } from '@/modules/auth';"),
        file('modules/chat/b.ts', "import { formatPrice } from '@/modules/product';"),
        file('modules/chat/c.ts', "import { useMyShop } from '@/modules/shop';"),
        file('modules/chat/d.ts', "import { useOrder } from '@/modules/order';"),
      ]);
      expect(v).toHaveLength(4);
      expect(v[0]).toContain("'chat' không được phụ thuộc module 'auth'");
      expect(v[1]).toContain("'chat' không được phụ thuộc module 'product'");
      expect(v[2]).toContain("'chat' không được phụ thuộc module 'shop'");
      expect(v[3]).toContain("'chat' không được phụ thuộc module 'order'");
    });

    it.each(BUSINESS_MODULES_OTHER_THAN_CHAT)(
      'cấm modules/%s import modules/chat, kể cả qua barrel',
      (name) => {
        const v = findViolations([
          file(`modules/${name}/a.ts`, "import { ChatInbox } from '@/modules/chat';"),
        ]);
        expect(v).toHaveLength(1);
        expect(v[0]).toContain(`'${name}' không được phụ thuộc module 'chat'`);
      },
    );

    it('page.tsx và shared/ vẫn được import barrel modules/chat, cấm import sâu', () => {
      const ok = findViolations([
        file('app/[locale]/chat/page.tsx', "import { ChatInbox } from '@/modules/chat';"),
        file(
          'shared/components/Header.tsx',
          "import { useChatUnreadCount } from '@/modules/chat';",
        ),
      ]);
      expect(ok).toEqual([]);

      const deep = findViolations([
        file(
          'shared/components/Header.tsx',
          "import { useMessages } from '@/modules/chat/hooks/useMessages';",
        ),
      ]);
      expect(deep).toHaveLength(1);
      expect(deep[0]).toContain('import sâu vào modules/chat/hooks/useMessages');
    });

    it('modules/chat vẫn được import shared/ và @ecommerce/types', () => {
      const v = findViolations([
        file(
          'modules/chat/a.ts',
          "import { apiFetch } from '@/shared/lib/api-client';\nimport { useRealtimeEvent } from '@/shared/realtime/useRealtimeEvent';\nimport type { ChatMessage } from '@ecommerce/types';",
        ),
      ]);
      expect(v).toEqual([]);
    });

    it('modules/notification là lá: cấm import mọi module nghiệp vụ và chat, kể cả qua barrel', () => {
      const v = findViolations([
        file('modules/notification/a.ts', "import { useAuthStore } from '@/modules/auth';"),
        file('modules/notification/b.ts', "import { useMyShop } from '@/modules/shop';"),
        file('modules/notification/c.ts', "import { useOrder } from '@/modules/order';"),
        file('modules/notification/d.ts', "import { useChatUnreadCount } from '@/modules/chat';"),
      ]);
      expect(v).toHaveLength(4);
      expect(v[0]).toContain("'notification' không được phụ thuộc module 'auth'");
      expect(v[1]).toContain("'notification' không được phụ thuộc module 'shop'");
      expect(v[2]).toContain("'notification' không được phụ thuộc module 'order'");
      expect(v[3]).toContain("'notification' không được phụ thuộc module 'chat'");
    });

    it.each([...BUSINESS_MODULES_OTHER_THAN_CHAT, 'chat'])(
      'cấm modules/%s import modules/notification, kể cả qua barrel',
      (name) => {
        const v = findViolations([
          file(
            `modules/${name}/a.ts`,
            "import { NotificationBell } from '@/modules/notification';",
          ),
        ]);
        expect(v).toHaveLength(1);
        expect(v[0]).toContain(`'${name}' không được phụ thuộc module 'notification'`);
      },
    );

    it('page.tsx và shared/ vẫn được import barrel modules/notification, cấm import sâu', () => {
      const ok = findViolations([
        file(
          'app/[locale]/notifications/page.tsx',
          "import { NotificationsContainer } from '@/modules/notification';",
        ),
        file(
          'shared/components/NotificationBell.tsx',
          "import { useUnreadNotificationCount } from '@/modules/notification';",
        ),
      ]);
      expect(ok).toEqual([]);

      const deep = findViolations([
        file(
          'shared/components/NotificationBell.tsx',
          "import { useUnreadNotificationCount } from '@/modules/notification/hooks/useUnreadNotificationCount';",
        ),
      ]);
      expect(deep).toHaveLength(1);
      expect(deep[0]).toContain(
        'import sâu vào modules/notification/hooks/useUnreadNotificationCount',
      );
    });

    it('modules/notification vẫn được import shared/ và @ecommerce/types', () => {
      const v = findViolations([
        file(
          'modules/notification/a.ts',
          "import { apiFetch } from '@/shared/lib/api-client';\nimport { scheduleInvalidate } from '@/shared/lib/schedule-invalidate';\nimport type { Notification } from '@ecommerce/types';",
        ),
      ]);
      expect(v).toEqual([]);
    });

    it('modules/appeal là lá: cấm import mọi module nghiệp vụ (kể cả shop), chat và notification, kể cả qua barrel', () => {
      const v = findViolations([
        file('modules/appeal/a.ts', "import { useMyShop } from '@/modules/shop';"),
        file('modules/appeal/b.ts', "import { useAuthStore } from '@/modules/auth';"),
        file('modules/appeal/c.ts', "import { formatPrice } from '@/modules/product';"),
        file('modules/appeal/d.ts', "import { useChatBadges } from '@/modules/chat';"),
        file('modules/appeal/e.ts', "import { NotificationBell } from '@/modules/notification';"),
        file('modules/appeal/f.ts', "import { AdminShopsContainer } from '@/modules/admin';"),
      ]);
      expect(v).toHaveLength(6);
      expect(v[0]).toContain("'appeal' không được phụ thuộc module 'shop'");
      expect(v[3]).toContain("'appeal' không được phụ thuộc module 'chat'");
      expect(v[4]).toContain("'appeal' không được phụ thuộc module 'notification'");
      expect(v[5]).toContain("'appeal' không được phụ thuộc module 'admin'");
    });

    it('không module nào import modules/appeal, kể cả qua barrel (chỉ page.tsx / app/_components ghép)', () => {
      const v = findViolations(
        [
          'account',
          'admin',
          'auth',
          'cart',
          'chat',
          'checkout',
          'notification',
          'order',
          'product',
          'report',
          'review',
          'shop',
          'voucher',
          'wishlist',
        ].map((name) =>
          file(`modules/${name}/a.ts`, "import { ShopAppealSection } from '@/modules/appeal';"),
        ),
      );
      expect(v).toHaveLength(14);
      for (const violation of v) {
        expect(violation).toContain("không được phụ thuộc module 'appeal'");
      }
    });

    it('app/ và shared/ vẫn được import barrel modules/appeal, cấm import sâu', () => {
      const ok = findViolations([
        file(
          'app/[locale]/seller/shop/_components/SellerShopAppealEntry.tsx',
          "import { ShopAppealSection } from '@/modules/appeal';",
        ),
      ]);
      expect(ok).toEqual([]);

      const deep = findViolations([
        file(
          'app/[locale]/seller/shop/_components/X.tsx',
          "import { ShopAppealSection } from '@/modules/appeal/components/ShopAppealSection';",
        ),
      ]);
      expect(deep).toHaveLength(1);
      expect(deep[0]).toContain('import sâu vào modules/appeal/components/ShopAppealSection');
    });

    it('modules/appeal vẫn được import shared/ và @ecommerce/types', () => {
      const v = findViolations([
        file(
          'modules/appeal/a.ts',
          "import { apiFetch } from '@/shared/lib/api-client';\nimport { shouldRetryQuery } from '@/shared/lib/should-retry-query';\nimport type { OwnerAppeal } from '@ecommerce/types';",
        ),
      ]);
      expect(v).toEqual([]);
    });

    it('modules/report là lá: cấm import mọi module nghiệp vụ (kể cả auth, shop, review), chat, notification và appeal, kể cả qua barrel', () => {
      const v = findViolations([
        file('modules/report/a.ts', "import { useAuthStore } from '@/modules/auth';"),
        file('modules/report/b.ts', "import { useMyShop } from '@/modules/shop';"),
        file('modules/report/c.ts', "import { ReviewItem } from '@/modules/review';"),
        file('modules/report/d.ts', "import { useChatBadges } from '@/modules/chat';"),
        file('modules/report/e.ts', "import { NotificationBell } from '@/modules/notification';"),
        file('modules/report/f.ts', "import { AdminShopsContainer } from '@/modules/admin';"),
        file('modules/report/g.ts', "import { ShopAppealSection } from '@/modules/appeal';"),
      ]);
      expect(v).toHaveLength(7);
      expect(v[0]).toContain("'report' không được phụ thuộc module 'auth'");
      expect(v[1]).toContain("'report' không được phụ thuộc module 'shop'");
      expect(v[2]).toContain("'report' không được phụ thuộc module 'review'");
      expect(v[3]).toContain("'report' không được phụ thuộc module 'chat'");
      expect(v[4]).toContain("'report' không được phụ thuộc module 'notification'");
      expect(v[5]).toContain("'report' không được phụ thuộc module 'admin'");
      expect(v[6]).toContain("'report' không được phụ thuộc module 'appeal'");
    });

    it.each(
      [...BUSINESS_MODULES_OTHER_THAN_CHAT, 'chat', 'notification'].filter((n) => n !== 'report'),
    )(
      'cấm modules/%s import modules/report, kể cả qua barrel (chỉ page.tsx / app/_components ghép)',
      (name) => {
        const v = findViolations([
          file(`modules/${name}/a.ts`, "import { ReportButton } from '@/modules/report';"),
        ]);
        expect(v).toHaveLength(1);
        expect(v[0]).toContain(`'${name}' không được phụ thuộc module 'report'`);
      },
    );

    it('app/ và shared/ vẫn được import barrel modules/report (kể cả import() động), cấm import sâu', () => {
      const ok = findViolations([
        file(
          'app/[locale]/_components/ReportEntry.tsx',
          "const load = () => import('@/modules/report');",
        ),
      ]);
      expect(ok).toEqual([]);

      const deep = findViolations([
        file(
          'app/[locale]/_components/X.tsx',
          "import { ReportButton } from '@/modules/report/components/ReportButton';",
        ),
      ]);
      expect(deep).toHaveLength(1);
      expect(deep[0]).toContain('import sâu vào modules/report/components/ReportButton');
    });

    it('modules/report vẫn được import shared/ và @ecommerce/types', () => {
      const v = findViolations([
        file(
          'modules/report/a.ts',
          "import { apiFetch } from '@/shared/lib/api-client';\nimport { Button } from '@/shared/components/ui/button';\nimport type { CreateReportInput } from '@ecommerce/types';",
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
