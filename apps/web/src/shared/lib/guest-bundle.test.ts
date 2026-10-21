import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

// Giữ cho KHÁCH VÃNG LAI không tải mã chat (Week10.md 6.3, chore/chat-lazy-load). Đo Lighthouse khi so `main` trước/sau
// chat FE: +14,8 KB JS và 2 tệp script thêm ở `/` và `/products`, vì layout/Header/AccountSheet import TĨNH các mảnh
// chat (đồng bộ real-time, biểu tượng + huy hiệu tin nhắn) mà khách không bao giờ dùng. Giờ chúng đi qua wrapper
// `React.lazy` ở `shared/components/lazy-chat.tsx` (chỉ yêu cầu chunk khi `user !== null`).
//
// Hồi quy kiểu này IM LẶNG: build vẫn xanh, test chức năng vẫn xanh, chỉ bundle của khách phình ra lần nữa — nên khoá bằng
// test đọc mã nguồn, cùng tinh thần module-boundaries.test.ts. Không thể kiểm chunk thật trong jsdom; phép đo thật là
// Lighthouse / tổng JS tải về ở `/` (xem Week10.md).

const SRC_ROOT = resolve(__dirname, '..', '..'); // apps/web/src

// Các tệp NẰM TRÊN đường tải của khách (layout + khung trang dùng chung): không được kéo mã chat vào chunk chung.
const GUEST_CRITICAL_FILES = [
  'app/[locale]/layout.tsx',
  'shared/components/Header.tsx',
  'shared/components/AccountSheet.tsx',
  'shared/components/BottomTabBar.tsx',
  // Layout import tĩnh tệp này: trước đây nó import `resetChatOutbox` từ barrel chat (có `export * as chatService`) và kéo
  // cả dịch vụ chat vào bundle của khách — việc dọn hộp chờ giờ nằm ở ChatRealtimeSync (nạp động).
  'shared/components/SessionCacheReset.tsx',
];

// Mọi cách import TĨNH mã chat chỉ-dành-cho-người-đăng-nhập.
const FORBIDDEN_STATIC_IMPORTS = [
  /from\s+['"]@\/shared\/components\/ChatRealtimeSync['"]/,
  /from\s+['"]@\/shared\/components\/HeaderChatLink['"]/,
  /from\s+['"]@\/shared\/components\/ChatUnreadBadge['"]/,
  /from\s+['"]@\/shared\/hooks\/useChatBadges['"]/,
  /from\s+['"]@\/modules\/chat['"]/,
  /from\s+['"]\.\/(ChatRealtimeSync|HeaderChatLink|ChatUnreadBadge)['"]/,
];

const read = (relativePath: string) => readFileSync(resolve(SRC_ROOT, relativePath), 'utf8');

describe('khách vãng lai không tải mã chat', () => {
  it.each(GUEST_CRITICAL_FILES)('%s không import tĩnh mã chat — phải đi qua lazy-chat', (file) => {
    const source = read(file);

    for (const forbidden of FORBIDDEN_STATIC_IMPORTS) {
      expect(source, `${file} khớp ${String(forbidden)}`).not.toMatch(forbidden);
    }
  });

  it('các tệp trên dùng wrapper lazy-chat (đảm bảo test trên không xanh vì tệp không còn dùng chat)', () => {
    expect(read('app/[locale]/layout.tsx')).toMatch(/LazyChatRealtimeSync/);
    expect(read('shared/components/Header.tsx')).toMatch(/LazyHeaderChatLink/);
    expect(read('shared/components/Header.tsx')).toMatch(/LazyChatUnreadBadge/);
    expect(read('shared/components/AccountSheet.tsx')).toMatch(/LazyChatUnreadBadge/);
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
});
