import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

// Giữ cho KHÁCH VÃNG LAI không tải mã chat và mã thông báo (Week10.md 6.3, chore/chat-lazy-load; 8.3 cùng cách cho thông
// báo). Đo Lighthouse khi so `main` trước/sau chat FE: +14,8 KB JS và 2 tệp script thêm ở `/` và `/products`, vì
// layout/Header/AccountSheet import TĨNH các mảnh chat (đồng bộ real-time, biểu tượng + huy hiệu tin nhắn) mà khách không
// bao giờ dùng. Giờ chúng đi qua wrapper `React.lazy` ở `shared/components/lazy-chat.tsx` (chỉ yêu cầu chunk khi
// `user !== null`); chuông/huy hiệu/đồng bộ thông báo đi qua `lazy-notification.tsx` y như vậy.
//
// Hồi quy kiểu này IM LẶNG: build vẫn xanh, test chức năng vẫn xanh, chỉ bundle của khách phình ra lần nữa — nên khoá bằng
// test đọc mã nguồn, cùng tinh thần module-boundaries.test.ts. Không thể kiểm chunk thật trong jsdom; phép đo thật là
// Lighthouse / tổng JS tải về ở `/` (xem Week10.md).

const SRC_ROOT = resolve(__dirname, '..', '..'); // apps/web/src

// Các tệp NẰM TRÊN đường tải của khách (layout + khung trang dùng chung): không được kéo mã chat/thông báo vào chunk chung.
const GUEST_CRITICAL_FILES = [
  'app/[locale]/layout.tsx',
  'shared/components/Header.tsx',
  'shared/components/AccountSheet.tsx',
  'shared/components/BottomTabBar.tsx',
  // Layout import tĩnh tệp này: trước đây nó import `resetChatOutbox` từ barrel chat (có `export * as chatService`) và kéo
  // cả dịch vụ chat vào bundle của khách — việc dọn hộp chờ giờ nằm ở ChatRealtimeSync (nạp động).
  'shared/components/SessionCacheReset.tsx',
];

// Mọi cách import TĨNH mã chat/thông báo chỉ-dành-cho-người-đăng-nhập.
const FORBIDDEN_STATIC_IMPORTS = [
  /from\s+['"]@\/shared\/components\/ChatRealtimeSync['"]/,
  /from\s+['"]@\/shared\/components\/HeaderChatLink['"]/,
  /from\s+['"]@\/shared\/components\/ChatUnreadBadge['"]/,
  /from\s+['"]@\/shared\/hooks\/useChatBadges['"]/,
  /from\s+['"]@\/modules\/chat['"]/,
  /from\s+['"]\.\/(ChatRealtimeSync|HeaderChatLink|ChatUnreadBadge)['"]/,
  /from\s+['"]@\/shared\/components\/NotificationRealtimeSync['"]/,
  /from\s+['"]@\/shared\/components\/NotificationBell['"]/,
  /from\s+['"]@\/shared\/components\/NotificationUnreadBadge['"]/,
  /from\s+['"]@\/modules\/notification['"]/,
  /from\s+['"]\.\/(NotificationRealtimeSync|NotificationBell|NotificationUnreadBadge)['"]/,
];

const read = (relativePath: string) => readFileSync(resolve(SRC_ROOT, relativePath), 'utf8');

describe('khách vãng lai không tải mã chat và thông báo', () => {
  it.each(GUEST_CRITICAL_FILES)(
    '%s không import tĩnh mã chat/thông báo — phải đi qua lazy-chat / lazy-notification',
    (file) => {
      const source = read(file);

      for (const forbidden of FORBIDDEN_STATIC_IMPORTS) {
        expect(source, `${file} khớp ${String(forbidden)}`).not.toMatch(forbidden);
      }
    },
  );

  it('các tệp trên DÙNG wrapper lazy trong JSX (không chỉ import tên — gỡ phần tử khỏi layout/Header phải làm test đỏ)', () => {
    const layout = read('app/[locale]/layout.tsx');
    expect(layout).toMatch(/<LazyChatRealtimeSync\s*\/>/);
    expect(layout).toMatch(/<LazyNotificationRealtimeSync\s*\/>/);

    const header = read('shared/components/Header.tsx');
    expect(header).toMatch(/<LazyHeaderChatLink\s/);
    expect(header).toMatch(/<LazyChatUnreadBadge\s/);
    expect(header).toMatch(/<LazyNotificationBell\s/);
    expect(header).toMatch(/<LazyNotificationUnreadBadge\s/);

    const accountSheet = read('shared/components/AccountSheet.tsx');
    expect(accountSheet).toMatch(/<LazyChatUnreadBadge\s/);
    expect(accountSheet).toMatch(/<LazyNotificationUnreadBadge\s/);
  });

  it('lazy-chat chỉ nạp các mảnh chat bằng import() động, không import tĩnh', () => {
    const source = read('shared/components/lazy-chat.tsx');

    for (const forbidden of FORBIDDEN_STATIC_IMPORTS) {
      expect(source, `lazy-chat khớp ${String(forbidden)}`).not.toMatch(forbidden);
    }
    for (const name of ['ChatRealtimeSync', 'HeaderChatLink', 'ChatUnreadBadge']) {
      expect(source).toMatch(new RegExp(`import\\('\\./${name}'\\)`));
    }
    expect(source).toMatch(/lazy\(/);
  });

  it('lazy-notification chỉ nạp các mảnh thông báo bằng import() động, không import tĩnh', () => {
    const source = read('shared/components/lazy-notification.tsx');

    for (const forbidden of FORBIDDEN_STATIC_IMPORTS) {
      expect(source, `lazy-notification khớp ${String(forbidden)}`).not.toMatch(forbidden);
    }
    for (const name of [
      'NotificationRealtimeSync',
      'NotificationBell',
      'NotificationUnreadBadge',
    ]) {
      expect(source).toMatch(new RegExp(`import\\('\\./${name}'\\)`));
    }
    expect(source).toMatch(/lazy\(/);
  });

  // Báo cáo vi phạm (Week11.md 5.6): nút "Báo cáo" nằm ở các trang công khai (sản phẩm, shop) mà khách vãng lai vào, nhưng khách không
  // báo cáo được (BE đòi đăng nhập). Mã hộp thoại / form / hook báo cáo vì vậy chỉ được nạp bằng import() động trong ReportEntry và
  // chỉ khi `user !== null`; mọi nơi khác đi qua ReportEntry, không import `@/modules/report` trực tiếp.
  it('ReportEntry chỉ nạp mã báo cáo bằng import() động và chỉ cho người đã đăng nhập; khách thấy link đăng nhập', () => {
    const source = read('app/[locale]/_components/ReportEntry.tsx');

    expect(source).not.toMatch(/from\s+['"]@\/modules\/report['"]/);
    expect(source).toMatch(/lazy\(\s*\(\)\s*=>\s*import\('@\/modules\/report'\)/);
    // Khách (user === null) rẽ sang link đăng nhập TRƯỚC khi chạm tới nút lazy.
    const guestBranch = source.indexOf('user === null');
    const lazyUse = source.indexOf('<ReportButtonImpl');
    expect(guestBranch).toBeGreaterThan(-1);
    expect(lazyUse).toBeGreaterThan(guestBranch);
    expect(source).toMatch(/pathname: '\/login'/);
  });

  it('không tệp nào ngoài ReportEntry import tĩnh modules/report (đường vào duy nhất là ReportEntry)', () => {
    const offenders = [
      'app/[locale]/_components/ShopReportEntry.tsx',
      'app/[locale]/products/[slug]/page.tsx',
      'app/[locale]/shops/[slug]/page.tsx',
      'app/[locale]/chat/page.tsx',
      'app/[locale]/seller/chat/page.tsx',
      ...GUEST_CRITICAL_FILES,
    ].filter((file) => /from\s+['"]@\/modules\/report['"]/.test(read(file)));

    expect(offenders).toEqual([]);
  });

  it('cổng đăng nhập: mọi wrapper lazy trả null khi chưa có người dùng (khách không yêu cầu chunk)', () => {
    for (const file of [
      'shared/components/lazy-chat.tsx',
      'shared/components/lazy-notification.tsx',
    ]) {
      const source = read(file);

      expect(source, file).toMatch(/useAuthStore\(\(state\) => state\.user !== null\)/);
      expect((source.match(/if \(!isSignedIn\) return null;/g) ?? []).length, file).toBe(3);
    }
  });
});
