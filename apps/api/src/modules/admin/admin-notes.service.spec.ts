import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { AdminNotesService, toAdminNote } from './admin-notes.service';

// Logic không cần DB của AdminNotesService (Week11.md 4.3): kiểm đối tượng tồn tại trước khi đọc/ghi, tác giả lấy từ phiên,
// ánh xạ response không lộ gì ngoài allowlist, cách ghép truy vấn của trang danh sách, và lỗi ghi của Prisma bị che giá trị.
// Ràng buộc DB (CHECK, trigger chỉ-thêm), thứ tự thật và phân trang trên Postgres do admin-notes.controller.int-spec.ts kiểm.
const TARGET_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ADMIN_ID = '33333333-3333-4333-8333-333333333333';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    targetType: 'SHOP' as const,
    targetId: TARGET_ID,
    authorId: ADMIN_ID,
    content: 'Chủ shop đã gọi lại',
    createdAt: new Date('2026-10-28T10:00:00.000Z'),
    ...overrides,
  };
}

function setup() {
  const prisma = {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    shop: { findUnique: jest.fn() },
    adminNote: {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };
  prisma.user.findUnique.mockResolvedValue({ id: TARGET_ID });
  prisma.shop.findUnique.mockResolvedValue({ id: TARGET_ID });
  prisma.user.findMany.mockResolvedValue([{ id: ADMIN_ID, name: 'Quản trị' }]);
  prisma.adminNote.count.mockResolvedValue(0);
  prisma.adminNote.findMany.mockResolvedValue([]);
  prisma.adminNote.create.mockResolvedValue(row());
  const service = new AdminNotesService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('toAdminNote', () => {
  it('trả đúng bảy trường của allowlist, mốc thời gian dạng ISO', () => {
    expect(toAdminNote(row(), 'Quản trị')).toEqual({
      id: 'note-1',
      targetType: 'SHOP',
      targetId: TARGET_ID,
      content: 'Chủ shop đã gọi lại',
      authorId: ADMIN_ID,
      authorName: 'Quản trị',
      createdAt: '2026-10-28T10:00:00.000Z',
    });
  });

  it('hàng DB lỡ có thêm trường lạ vẫn KHÔNG lọt vào response (dựng thủ công, không spread)', () => {
    const leaky = row({ internal: 'secret', authorEmail: 'admin@example.com' });

    const result = toAdminNote(leaky, null);

    expect(Object.keys(result).sort()).toEqual([
      'authorId',
      'authorName',
      'content',
      'createdAt',
      'id',
      'targetId',
      'targetType',
    ]);
    expect(JSON.stringify(result)).not.toContain('admin@example.com');
  });
});

describe('AdminNotesService.list', () => {
  const QUERY = {
    targetType: 'SHOP' as const,
    targetId: TARGET_ID,
    page: 1,
    limit: 20,
  };

  it('chỉ đọc ghi chú của ĐÚNG đối tượng, mới nhất trước với id là khoá phụ', async () => {
    const { service, prisma } = setup();

    await service.list(QUERY);

    const where = { targetType: 'SHOP', targetId: TARGET_ID };
    expect(prisma.adminNote.count).toHaveBeenCalledWith({ where });
    expect(prisma.adminNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it.each([
    [1, 20, 0],
    [3, 20, 40],
    [2, 50, 50],
  ])('trang %i với limit %i ⇒ bỏ qua %i dòng', async (page, limit, skip) => {
    const { service, prisma } = setup();

    await service.list({ ...QUERY, page, limit });

    expect(prisma.adminNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip, take: limit }),
    );
  });

  it('chọn cột bằng select hẹp (không đọc cả hàng) và trả total/page/limit', async () => {
    const { service, prisma } = setup();
    prisma.adminNote.count.mockResolvedValue(41);

    const result = await service.list({ ...QUERY, page: 2, limit: 20 });

    expect(prisma.adminNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          targetType: true,
          targetId: true,
          authorId: true,
          content: true,
          createdAt: true,
        },
      }),
    );
    expect(result).toMatchObject({ total: 41, page: 2, limit: 20 });
  });

  it('tra tên tác giả MỘT lần cho cả trang (khử trùng id), chỉ lấy id và tên', async () => {
    const { service, prisma } = setup();
    prisma.adminNote.findMany.mockResolvedValue([
      row({ id: 'a', authorId: ADMIN_ID }),
      row({ id: 'b', authorId: ADMIN_ID }),
      row({ id: 'c', authorId: OTHER_ADMIN_ID }),
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: ADMIN_ID, name: 'An' },
      { id: OTHER_ADMIN_ID, name: 'Bình' },
    ]);

    const result = await service.list(QUERY);

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [ADMIN_ID, OTHER_ADMIN_ID] } },
      select: { id: true, name: true },
    });
    expect(result.items.map((item) => item.authorName)).toEqual([
      'An',
      'An',
      'Bình',
    ]);
  });

  it('trang rỗng không tra tên nào; Admin đã bị xoá ⇒ authorName null', async () => {
    const { service, prisma } = setup();

    await service.list(QUERY);
    expect(prisma.user.findMany).not.toHaveBeenCalled();

    prisma.adminNote.findMany.mockResolvedValue([row()]);
    prisma.user.findMany.mockResolvedValue([]);
    const result = await service.list(QUERY);
    expect(result.items[0].authorName).toBeNull();
  });

  it.each([
    ['USER', 'user'],
    ['SHOP', 'shop'],
  ] as const)(
    'đối tượng %s không tồn tại ⇒ 404 ADMIN_NOTE_TARGET_NOT_FOUND, không đọc ghi chú nào',
    async (targetType, table) => {
      const { service, prisma } = setup();
      prisma[table].findUnique.mockResolvedValue(null);

      await expectAppException(service.list({ ...QUERY, targetType }), {
        status: 404,
        code: 'ADMIN_NOTE_TARGET_NOT_FOUND',
      });

      expect(prisma.adminNote.count).not.toHaveBeenCalled();
      expect(prisma.adminNote.findMany).not.toHaveBeenCalled();
    },
  );

  it('kiểm đối tượng ở ĐÚNG bảng theo loại (USER ⇒ users, SHOP ⇒ shops)', async () => {
    const user = setup();
    await user.service.list({ ...QUERY, targetType: 'USER' });
    expect(user.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: TARGET_ID },
      select: { id: true },
    });
    expect(user.prisma.shop.findUnique).not.toHaveBeenCalled();

    const shop = setup();
    await shop.service.list({ ...QUERY, targetType: 'SHOP' });
    expect(shop.prisma.shop.findUnique).toHaveBeenCalledWith({
      where: { id: TARGET_ID },
      select: { id: true },
    });
    expect(shop.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('id sai dạng ⇒ cùng 404, không chạm DB', async () => {
    const { service, prisma } = setup();

    for (const targetId of ['not-a-uuid', `${TARGET_ID}\u0000`, '']) {
      await expectAppException(service.list({ ...QUERY, targetId }), {
        status: 404,
        code: 'ADMIN_NOTE_TARGET_NOT_FOUND',
      });
    }

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.shop.findUnique).not.toHaveBeenCalled();
    expect(prisma.adminNote.findMany).not.toHaveBeenCalled();
  });
});

describe('AdminNotesService.create', () => {
  const INPUT = {
    targetType: 'SHOP' as const,
    targetId: TARGET_ID,
    content: 'Chủ shop đã gọi lại',
  };

  it('ghi đúng đối tượng, nội dung và TÁC GIẢ là Admin của phiên; không truyền thời điểm (DB đóng dấu)', async () => {
    const { service, prisma } = setup();

    await service.create(ADMIN_ID, INPUT);

    expect(prisma.adminNote.create).toHaveBeenCalledTimes(1);
    const args = prisma.adminNote.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(args[0].data).toEqual({
      targetType: 'SHOP',
      targetId: TARGET_ID,
      authorId: ADMIN_ID,
      content: 'Chủ shop đã gọi lại',
    });
    expect(args[0].data).not.toHaveProperty('createdAt');
  });

  it('input lỡ mang authorId lạ vẫn KHÔNG được ghi: tác giả luôn là tham số adminId', async () => {
    const { service, prisma } = setup();
    const sneaky = { ...INPUT, authorId: OTHER_ADMIN_ID } as typeof INPUT;

    await service.create(ADMIN_ID, sneaky);

    const args = prisma.adminNote.create.mock.calls[0] as [
      { data: { authorId: string } },
    ];
    expect(args[0].data.authorId).toBe(ADMIN_ID);
  });

  it('trả ghi chú vừa tạo kèm tên Admin', async () => {
    const { service } = setup();

    const result = await service.create(ADMIN_ID, INPUT);

    expect(result.note).toEqual({
      id: 'note-1',
      targetType: 'SHOP',
      targetId: TARGET_ID,
      content: 'Chủ shop đã gọi lại',
      authorId: ADMIN_ID,
      authorName: 'Quản trị',
      createdAt: '2026-10-28T10:00:00.000Z',
    });
  });

  it('đối tượng không tồn tại ⇒ 404 và KHÔNG ghi gì', async () => {
    const { service, prisma } = setup();
    prisma.shop.findUnique.mockResolvedValue(null);

    await expectAppException(service.create(ADMIN_ID, INPUT), {
      status: 404,
      code: 'ADMIN_NOTE_TARGET_NOT_FOUND',
    });

    expect(prisma.adminNote.create).not.toHaveBeenCalled();
  });

  it('id sai dạng ⇒ 404 và KHÔNG chạm DB', async () => {
    const { service, prisma } = setup();

    await expectAppException(
      service.create(ADMIN_ID, { ...INPUT, targetId: 'not-a-uuid' }),
      { status: 404, code: 'ADMIN_NOTE_TARGET_NOT_FOUND' },
    );

    expect(prisma.shop.findUnique).not.toHaveBeenCalled();
    expect(prisma.adminNote.create).not.toHaveBeenCalled();
  });

  // Prisma in NGUYÊN giá trị đã ghi vào message/stack của PrismaClientValidationError và AllExceptionsFilter log cả stack — nội
  // dung ghi chú (riêng tư) không được lọt ra đường đó (rules/backend.md, Week11.md 2.4).
  it('lỗi ghi mang giá trị đã ghi bị che: lỗi ném ra không chứa nội dung ghi chú', async () => {
    const { service, prisma } = setup();
    const canary = 'GHI-CHU-RIENG-TU-CANARY';
    prisma.adminNote.create.mockRejectedValue(
      new Prisma.PrismaClientValidationError(
        `Invalid prisma.adminNote.create() invocation: data: { content: "${canary}" }`,
        { clientVersion: 'test' },
      ),
    );

    const error = await service
      .create(ADMIN_ID, { ...INPUT, content: canary })
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(Error);
    const failure = error as Error;
    expect(`${failure.message}\n${failure.stack}`).not.toContain(canary);
    expect(failure.message).toContain('admin note');
  });

  it('lỗi KHÔNG mang giá trị (vd DB sập) được ném nguyên để chẩn đoán được', async () => {
    const { service, prisma } = setup();
    const down = new Error('connection refused');
    prisma.adminNote.create.mockRejectedValue(down);

    await expect(service.create(ADMIN_ID, INPUT)).rejects.toBe(down);
  });
});
