import {
  cleanupAdminNotifications,
  clearSuiteStart,
  describeCleanupOutcome,
  isLocalDatabaseUrl,
  readSuiteStart,
  recordSuiteStart,
  resolveDatabaseUrl,
  runAdminNotificationCleanup,
  type AdminNotificationCleanupClient,
} from './admin-notification-cleanup';

const SINCE = new Date('2026-10-27T03:00:00.000Z');
const LOCAL_URL =
  'postgresql://postgres:postgres@localhost:5433/ecommerce?schema=public';

function createFakeClient(
  deleteMany: jest.Mock = jest.fn().mockResolvedValue({ count: 0 }),
) {
  const disconnect = jest.fn().mockResolvedValue(undefined);
  const client = {
    notification: { deleteMany },
    $disconnect: disconnect,
  } as unknown as AdminNotificationCleanupClient;
  return { client, deleteMany, disconnect };
}

describe('isLocalDatabaseUrl', () => {
  it.each([
    ['localhost', LOCAL_URL],
    ['127.0.0.1', 'postgresql://postgres:postgres@127.0.0.1:5432/ecommerce'],
    ['scheme postgres://', 'postgres://postgres:postgres@localhost/ecommerce'],
    ['không có cổng', 'postgresql://postgres@localhost/ecommerce'],
    ['viết hoa', 'postgresql://postgres:postgres@LOCALHOST:5433/ecommerce'],
  ])('chấp nhận %s', (_label, url) => {
    expect(isLocalDatabaseUrl(url)).toBe(true);
  });

  it.each([
    ['không đặt', undefined],
    ['chuỗi rỗng', ''],
    ['không phải URL', 'not a url'],
    [
      'Neon',
      'postgresql://u:p@ep-cool-123.ap-southeast-1.aws.neon.tech/db?sslmode=require',
    ],
    ['tên máy chứa "localhost"', 'postgresql://u:p@localhost.example.com/db'],
    ['tên miền con của localhost', 'postgresql://u:p@db.localhost/db'],
    ['IP chứa 127.0.0.1', 'postgresql://u:p@127.0.0.1.nip.io/db'],
    ['IPv4 khác', 'postgresql://u:p@10.0.0.5:5432/db'],
    ['máy trong mạng Docker', 'postgresql://u:p@postgres:5432/db'],
    [
      'host-gateway của Docker',
      'postgresql://u:p@host.docker.internal:5432/db',
    ],
    [
      'localhost đứng ở mật khẩu, máy thật ở sau @',
      'postgresql://u:localhost@db.example.com/db',
    ],
    [
      'localhost đứng ở tên người dùng',
      'postgresql://localhost@db.example.com/db',
    ],
    [
      '?host= ghi đè máy chủ',
      'postgresql://u:p@localhost/db?host=db.example.com',
    ],
    [
      '?hostaddr= ghi đè máy chủ',
      'postgresql://u:p@localhost/db?hostaddr=10.0.0.5',
    ],
    ['scheme khác', 'mysql://u:p@localhost/db'],
    ['scheme http', 'http://localhost/db'],
  ])('từ chối %s', (_label, url) => {
    expect(isLocalDatabaseUrl(url)).toBe(false);
  });
});

describe('resolveDatabaseUrl', () => {
  it('biến môi trường thắng .env', () => {
    expect(
      resolveDatabaseUrl(
        { DATABASE_URL: 'from-env' },
        { DATABASE_URL: 'from-file' },
      ),
    ).toBe('from-env');
  });

  it('rơi về .env khi biến môi trường không đặt hoặc chỉ là khoảng trắng/chuỗi rỗng', () => {
    expect(resolveDatabaseUrl({}, { DATABASE_URL: 'from-file' })).toBe(
      'from-file',
    );
    expect(
      resolveDatabaseUrl({ DATABASE_URL: '' }, { DATABASE_URL: 'from-file' }),
    ).toBe('from-file');
    expect(
      resolveDatabaseUrl({ DATABASE_URL: '  ' }, { DATABASE_URL: 'from-file' }),
    ).toBe('from-file');
  });

  it('cắt khoảng trắng hai đầu', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: ' postgresql://x ' }, {})).toBe(
      'postgresql://x',
    );
  });

  it('không có ở đâu cả ⇒ undefined', () => {
    expect(resolveDatabaseUrl({}, {})).toBeUndefined();
    expect(
      resolveDatabaseUrl({ DATABASE_URL: '' }, { DATABASE_URL: ' ' }),
    ).toBeUndefined();
  });
});

describe('cleanupAdminNotifications', () => {
  it('chỉ xoá thông báo của người dùng ADMIN và chỉ từ mốc trở đi, trả về số hàng đã xoá', async () => {
    const { client, deleteMany } = createFakeClient(
      jest.fn().mockResolvedValue({ count: 7 }),
    );

    await expect(cleanupAdminNotifications(client, SINCE)).resolves.toBe(7);

    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: SINCE }, user: { role: 'ADMIN' } },
    });
  });
});

describe('suite start mark', () => {
  afterEach(() => {
    clearSuiteStart();
  });

  it('chưa ghi thì chưa có mốc', () => {
    expect(readSuiteStart()).toBeUndefined();
  });

  it('globalSetup ghi, globalTeardown đọc lại đúng mốc', () => {
    recordSuiteStart(SINCE);

    expect(readSuiteStart()).toBe(SINCE);
  });

  it('xoá mốc ⇒ đọc lại là undefined', () => {
    recordSuiteStart(SINCE);
    clearSuiteStart();

    expect(readSuiteStart()).toBeUndefined();
  });

  it('mặc định là thời điểm hiện tại', () => {
    const before = Date.now();
    recordSuiteStart();
    const after = Date.now();

    const mark = readSuiteStart();
    expect(mark).toBeInstanceOf(Date);
    expect(mark!.getTime()).toBeGreaterThanOrEqual(before);
    expect(mark!.getTime()).toBeLessThanOrEqual(after);
  });
});

describe('runAdminNotificationCleanup', () => {
  it('DB cục bộ + có mốc ⇒ dọn, trả số đếm và ngắt kết nối', async () => {
    const { client, deleteMany, disconnect } = createFakeClient(
      jest.fn().mockResolvedValue({ count: 25 }),
    );
    const createClient = jest.fn().mockReturnValue(client);

    const outcome = await runAdminNotificationCleanup({
      databaseUrl: LOCAL_URL,
      since: SINCE,
      createClient,
    });

    expect(outcome).toEqual({ status: 'cleaned', count: 25 });
    // Client được tạo bằng ĐÚNG chuỗi đã kiểm, không để Prisma tự đọc lại .env.
    expect(createClient).toHaveBeenCalledWith(LOCAL_URL);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Neon', 'postgresql://u:p@ep-cool-123.aws.neon.tech/db?sslmode=require'],
    ['máy lạ', 'postgresql://u:p@db.example.com:5432/db'],
    ['không đặt', undefined],
    ['không đọc được', 'not a url'],
    ['?host= ghi đè', 'postgresql://u:p@localhost/db?host=db.example.com'],
  ])(
    'DB không phải localhost (%s) ⇒ bỏ qua và KHÔNG tạo client, KHÔNG xoá gì',
    async (_label, databaseUrl) => {
      const { client, deleteMany } = createFakeClient();
      const createClient = jest.fn().mockReturnValue(client);

      const outcome = await runAdminNotificationCleanup({
        databaseUrl,
        since: SINCE,
        createClient,
      });

      expect(outcome).toEqual({
        status: 'skipped',
        reason: 'NON_LOCAL_DATABASE',
      });
      expect(createClient).not.toHaveBeenCalled();
      expect(deleteMany).not.toHaveBeenCalled();
    },
  );

  it('không có mốc bắt đầu ⇒ bỏ qua và KHÔNG xoá gì (không có mốc nghĩa là có thể xoá cả thông báo cũ)', async () => {
    const { client, deleteMany } = createFakeClient();
    const createClient = jest.fn().mockReturnValue(client);

    const outcome = await runAdminNotificationCleanup({
      databaseUrl: LOCAL_URL,
      since: undefined,
      createClient,
    });

    expect(outcome).toEqual({ status: 'skipped', reason: 'NO_START_MARK' });
    expect(createClient).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('xoá lỗi ⇒ trả "failed", KHÔNG ném, vẫn ngắt kết nối, thông điệp không chứa chuỗi kết nối', async () => {
    const { client, disconnect } = createFakeClient(
      jest.fn().mockRejectedValue(new Error('connection refused')),
    );

    const outcome = await runAdminNotificationCleanup({
      databaseUrl: LOCAL_URL,
      since: SINCE,
      createClient: () => client,
    });

    expect(outcome).toEqual({
      status: 'failed',
      message: 'connection refused',
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(outcome)).not.toContain('postgres:postgres');
  });

  it('tạo client lỗi ⇒ trả "failed", KHÔNG ném', async () => {
    const outcome = await runAdminNotificationCleanup({
      databaseUrl: LOCAL_URL,
      since: SINCE,
      createClient: () => {
        throw new Error('cannot create client');
      },
    });

    expect(outcome).toEqual({
      status: 'failed',
      message: 'cannot create client',
    });
  });

  it('lỗi không phải Error ⇒ vẫn trả "failed" với thông điệp chung', async () => {
    const { client } = createFakeClient(jest.fn().mockRejectedValue('boom'));

    const outcome = await runAdminNotificationCleanup({
      databaseUrl: LOCAL_URL,
      since: SINCE,
      createClient: () => client,
    });

    expect(outcome).toEqual({ status: 'failed', message: 'unknown error' });
  });

  it('ngắt kết nối lỗi cũng không làm hỏng kết quả', async () => {
    const { client, disconnect } = createFakeClient(
      jest.fn().mockResolvedValue({ count: 3 }),
    );
    disconnect.mockRejectedValue(new Error('already closed'));

    await expect(
      runAdminNotificationCleanup({
        databaseUrl: LOCAL_URL,
        since: SINCE,
        createClient: () => client,
      }),
    ).resolves.toEqual({ status: 'cleaned', count: 3 });
  });
});

describe('describeCleanupOutcome', () => {
  it('nêu số đếm khi đã dọn', () => {
    expect(describeCleanupOutcome({ status: 'cleaned', count: 25 })).toContain(
      '25',
    );
  });

  it('nói rõ lý do khi bỏ qua và khi lỗi', () => {
    expect(
      describeCleanupOutcome({
        status: 'skipped',
        reason: 'NON_LOCAL_DATABASE',
      }),
    ).toContain('localhost');
    expect(
      describeCleanupOutcome({ status: 'skipped', reason: 'NO_START_MARK' }),
    ).toContain('mốc');
    expect(
      describeCleanupOutcome({ status: 'failed', message: 'boom' }),
    ).toContain('boom');
  });
});
