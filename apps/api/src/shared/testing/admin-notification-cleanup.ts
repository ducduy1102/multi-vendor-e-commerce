import type { PrismaClient } from '@prisma/client';

// Dọn thông báo gửi tới Admin do bộ test để lại (Week11.md 2.1, D19). Int-spec/e2e chạy luồng nghiệp vụ thật trên DB
// dev nên các sự kiện như ADMIN_SHOP_PENDING hay REFUND_REQUEST_ESCALATED được ghi cho MỌI Admin ACTIVE — gồm cả Admin
// thật (seed) của DB dev, không mang tiền tố test nên `cleanupByTag` không thấy. Từng spec đã tự dọn phần của mình;
// đây là lưới an toàn bổ sung chạy MỘT lần sau cả bộ (jest globalTeardown) cho spec nào quên hoặc spec viết sau này.
//
// File này nằm ở `shared/testing/` để unit test của Jest (chỉ quét `src/`) thấy được, còn phần nối vào Jest
// (`test/global-setup.ts`, `test/global-teardown.ts`) chỉ là keo mỏng.

// Chỉ DB trên chính máy này. Có chủ đích là danh sách đóng (không "mọi thứ trừ Neon"): thêm một DB lạ vào .env không
// bao giờ vô tình trở thành mục tiêu của lệnh xoá.
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1']);

// Tham số chuỗi kết nối có thể ĐỔI máy chủ thật sự mà `URL.hostname` không thấy (libpq: `?host=`, `?hostaddr=`).
const HOST_OVERRIDE_PARAMS = ['host', 'hostaddr'];

const SUITE_START_KEY = '__ecommerceAdminNotificationCleanupSince';

type GlobalWithSuiteStart = typeof globalThis & {
  [SUITE_START_KEY]?: Date;
};

export type AdminNotificationCleaner = Pick<PrismaClient, 'notification'>;

export type AdminNotificationCleanupClient = AdminNotificationCleaner &
  Pick<PrismaClient, '$disconnect'>;

export type AdminNotificationCleanupOutcome =
  | { status: 'cleaned'; count: number }
  | { status: 'skipped'; reason: 'NO_START_MARK' | 'NON_LOCAL_DATABASE' }
  | { status: 'failed'; message: string };

// `globalSetup` và `globalTeardown` của Jest chạy trong cùng tiến trình cha nên chia sẻ được `globalThis` (đây là
// cách duy nhất Jest cho hai file này trao đổi dữ liệu).
export function recordSuiteStart(now: Date = new Date()): void {
  (globalThis as GlobalWithSuiteStart)[SUITE_START_KEY] = now;
}

export function readSuiteStart(): Date | undefined {
  return (globalThis as GlobalWithSuiteStart)[SUITE_START_KEY];
}

export function clearSuiteStart(): void {
  delete (globalThis as GlobalWithSuiteStart)[SUITE_START_KEY];
}

export function isLocalDatabaseUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    // Không đọc được thì không đoán: từ chối.
    return false;
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    return false;
  }
  if (HOST_OVERRIDE_PARAMS.some((name) => url.searchParams.has(name))) {
    return false;
  }
  // Với scheme không "đặc biệt" như postgresql:, hostname KHÔNG tự hạ chữ thường.
  return LOCAL_DATABASE_HOSTS.has(url.hostname.toLowerCase());
}

// Cùng thứ tự ưu tiên Prisma dùng: biến môi trường thắng `.env`. Dùng `.trim() ||` thay vì `??` để `DATABASE_URL=`
// (chuỗi rỗng) cũng rơi về giá trị còn lại (rules/general.md mục 4).
export function resolveDatabaseUrl(
  processEnv: Record<string, string | undefined>,
  envFileValues: Record<string, string | undefined>,
): string | undefined {
  return (
    processEnv.DATABASE_URL?.trim() ||
    envFileValues.DATABASE_URL?.trim() ||
    undefined
  );
}

// Chỉ thông báo của người dùng `role = ADMIN` và chỉ từ mốc `since` trở đi: thông báo cũ hơn (của Admin thật, hay do
// test tay) và của mọi người dùng thường đều không bị đụng. `gte` (không phải `gt`) để hàng đúng mốc cũng được dọn.
export async function cleanupAdminNotifications(
  prisma: AdminNotificationCleaner,
  since: Date,
): Promise<number> {
  const { count } = await prisma.notification.deleteMany({
    where: { createdAt: { gte: since }, user: { role: 'ADMIN' } },
  });
  return count;
}

// KHÔNG BAO GIỜ ném: lưới an toàn hỏng không được làm cả lượt test đỏ. Chuỗi kết nối được kiểm RỒI mới tạo client
// bằng đúng chuỗi đó (không để Prisma tự đọc lại .env) nên chuỗi đã kiểm và chuỗi thực sự kết nối là một.
export async function runAdminNotificationCleanup(deps: {
  databaseUrl: string | undefined;
  since: Date | undefined;
  createClient: (databaseUrl: string) => AdminNotificationCleanupClient;
}): Promise<AdminNotificationCleanupOutcome> {
  const { databaseUrl, since, createClient } = deps;
  if (!since) return { status: 'skipped', reason: 'NO_START_MARK' };
  if (!databaseUrl || !isLocalDatabaseUrl(databaseUrl)) {
    return { status: 'skipped', reason: 'NON_LOCAL_DATABASE' };
  }
  let client: AdminNotificationCleanupClient | undefined;
  try {
    client = createClient(databaseUrl);
    const count = await cleanupAdminNotifications(client, since);
    return { status: 'cleaned', count };
  } catch (error) {
    // Chỉ lấy thông điệp, không nối chuỗi kết nối hay dữ liệu vào output.
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'unknown error',
    };
  } finally {
    await client?.$disconnect().catch(() => undefined);
  }
}

// Một dòng cho người chạy test; `null` = không có gì đáng nói.
export function describeCleanupOutcome(
  outcome: AdminNotificationCleanupOutcome,
): string | null {
  switch (outcome.status) {
    case 'cleaned':
      return `[test] Đã dọn ${outcome.count} thông báo Admin do bộ test để lại.`;
    case 'skipped':
      return outcome.reason === 'NON_LOCAL_DATABASE'
        ? '[test] Bỏ qua dọn thông báo Admin: DATABASE_URL không trỏ localhost/127.0.0.1 (không bao giờ xoá trên DB từ xa).'
        : '[test] Bỏ qua dọn thông báo Admin: không có mốc bắt đầu (globalSetup chưa chạy).';
    case 'failed':
      return `[test] Không dọn được thông báo Admin (bỏ qua, không ảnh hưởng kết quả test): ${outcome.message}`;
  }
}
