import { Logger } from '@nestjs/common';
import {
  ADMIN_ACCOUNT_STATUS_TRANSITIONS,
  accountStatusSchema,
  type AccountStatus,
} from '@ecommerce/types';
import type { MailService } from '../../shared/mail/mail.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { AdminUserShopCascadeService } from './admin-user-shop-cascade.service';
import { AdminUserStatusService } from './admin-user-status.service';

// Logic không cần DB của khoá / mở tài khoản (Week11.md 3.3): bảng chuyển trạng thái được áp đủ 16 cặp, điều kiện của UPDATE
// (chống ghi đè khi hai Admin đua nhau), dữ liệu ghi theo từng hướng, thứ tự nhật ký → commit → side-effect, và việc lỗi
// side-effect không lan ra. Hành vi trên Postgres thật (phiên chết, đua thật, rollback thật) do
// admin-user-status.controller.int-spec.ts và test/admin-user-suspend.e2e-spec.ts kiểm.
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REASON = 'Vi phạm điều khoản — mã bí mật CANARY-REASON-9f3a';
const EMAIL = 'canary-owner@example.com';
const ALL: AccountStatus[] = [...accountStatusSchema.options];

interface Row {
  id: string;
  role: 'USER' | 'ADMIN';
  accountStatus: AccountStatus;
  email: string;
  name: string;
  locale: 'vi' | 'en';
  statusChangedAt: Date | null;
}

// Mốc tài khoản vào trạng thái hiện tại (cột `statusChangedAt`) — dùng để biết shop nào bị khoá bởi CHÍNH lần khoá này.
const LOCK_STARTED = new Date('2026-10-20T00:00:00.000Z');

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: USER_ID,
    role: 'USER',
    accountStatus: 'ACTIVE',
    email: EMAIL,
    name: 'Nguyễn Văn An',
    locale: 'vi',
    statusChangedAt: LOCK_STARTED,
    ...overrides,
  };
}

interface BuildOptions {
  updateCount?: number;
  // Số shop mỗi nhánh cascade báo đã xử lý / đang còn khoá.
  shopsSuspended?: number;
  shopsReopened?: number;
  shopsStillSuspended?: number;
}

function build(current: Row | null, options: BuildOptions = {}) {
  const calls: string[] = [];
  const tx = {
    user: {
      findUnique: jest.fn().mockResolvedValue(current),
      updateMany: jest.fn().mockImplementation(() => {
        calls.push('updateMany');
        return Promise.resolve({ count: options.updateCount ?? 1 });
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: USER_ID,
        email: EMAIL,
        name: 'Nguyễn Văn An',
        role: 'USER',
        accountStatus: 'SUSPENDED',
        statusReason: REASON,
        statusChangedAt: new Date('2026-10-27T10:00:00.000Z'),
        emailVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => {
      const result = await callback(tx);
      calls.push('commit');
      return result;
    }),
  };
  const audit = {
    record: jest.fn().mockImplementation(() => {
      calls.push('audit');
      return Promise.resolve();
    }),
  };
  const mail = {
    sendAccountStatusChanged: jest.fn().mockImplementation(() => {
      calls.push('mail');
      return Promise.resolve();
    }),
  };
  const realtime = {
    disconnectUser: jest.fn().mockImplementation(() => {
      calls.push('disconnect');
      return Promise.resolve();
    }),
    emitToUser: jest.fn(),
  };
  const shopCascade = {
    suspendOwnedShops: jest.fn().mockImplementation(() => {
      calls.push('cascade');
      return Promise.resolve(options.shopsSuspended ?? 0);
    }),
    reopenCascadeSuspendedShops: jest.fn().mockImplementation(() => {
      calls.push('cascade');
      return Promise.resolve(options.shopsReopened ?? 0);
    }),
    countSuspendedShops: jest.fn().mockImplementation(() => {
      calls.push('cascade');
      return Promise.resolve(options.shopsStillSuspended ?? 0);
    }),
  };
  const service = new AdminUserStatusService(
    prisma as unknown as PrismaService,
    audit,
    mail as unknown as MailService,
    realtime,
    shopCascade as unknown as AdminUserShopCascadeService,
  );
  return { service, tx, prisma, audit, mail, realtime, shopCascade, calls };
}

type Built = ReturnType<typeof build>;
const callsOf = (spy: jest.SpyInstance) => spy.mock.calls as unknown[][];
const updateArgs = (built: Built) =>
  (
    built.tx.user.updateMany.mock.calls as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ][]
  )[0][0];
const auditArgs = (built: Built) =>
  (built.audit.record.mock.calls as [unknown, Record<string, unknown>][])[0];
const mailArgs = (built: Built) =>
  (
    built.mail.sendAccountStatusChanged.mock.calls as [
      string,
      Record<string, unknown>,
    ][]
  )[0];

describe('AdminUserStatusService', () => {
  const savedSupport = process.env.SUPPORT_EMAIL;
  const savedFrontend = process.env.FRONTEND_URL;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.SUPPORT_EMAIL;
    process.env.FRONTEND_URL = 'https://app.example.com';
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedSupport === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = savedSupport;
    if (savedFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = savedFrontend;
  });

  describe('bảng chuyển trạng thái (cả 16 cặp)', () => {
    const allowed = new Set(
      ADMIN_ACCOUNT_STATUS_TRANSITIONS.map((e) => `${e.from}>${e.to}`),
    );
    const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

    it.each(pairs)('%s → %s', async (from, to) => {
      const built = build(row({ accountStatus: from }));
      const run =
        to === 'ACTIVE'
          ? built.service.reactivate(ADMIN_ID, USER_ID, { reason: REASON })
          : built.service.suspend(ADMIN_ID, USER_ID, {
              status: to as 'SUSPENDED' | 'BANNED',
              reason: REASON,
            });

      // DEACTIVATED không phải đích của endpoint nào: chỉ kiểm hai đích có endpoint.
      if (to === 'DEACTIVATED') {
        // Không thể gọi qua API công khai (schema chặn); service gọi trực tiếp với giá trị đó vẫn phải từ chối.
        await expect(run).rejects.toMatchObject({
          code: 'USER_INVALID_TRANSITION',
        });
        return;
      }

      if (allowed.has(`${from}>${to}`)) {
        await expect(run).resolves.toBeDefined();
        expect(built.tx.user.updateMany).toHaveBeenCalledTimes(1);
        expect(built.audit.record).toHaveBeenCalledTimes(1);
      } else {
        await expect(run).rejects.toMatchObject({
          status: 409,
          code: 'USER_INVALID_TRANSITION',
        });
        // Cạnh sai bị chặn TRƯỚC khi ghi bất cứ thứ gì.
        expect(built.tx.user.updateMany).not.toHaveBeenCalled();
        expect(built.audit.record).not.toHaveBeenCalled();
        expect(built.mail.sendAccountStatusChanged).not.toHaveBeenCalled();
        expect(built.realtime.disconnectUser).not.toHaveBeenCalled();
        // Cạnh sai ⇒ không đụng shop nào.
        expect(built.shopCascade.suspendOwnedShops).not.toHaveBeenCalled();
        expect(
          built.shopCascade.reopenCascadeSuspendedShops,
        ).not.toHaveBeenCalled();
        expect(built.shopCascade.countSuspendedShops).not.toHaveBeenCalled();
      }
    });
  });

  describe('khoá / cấm', () => {
    it('ACTIVE → SUSPENDED: UPDATE có điều kiện theo trạng thái cũ và vai USER, ghi lý do + mốc, thu hồi refresh token', async () => {
      const built = build(row());

      await built.service.suspend(ADMIN_ID, USER_ID, {
        status: 'SUSPENDED',
        reason: REASON,
      });

      const { where, data } = updateArgs(built);
      expect(where).toEqual({
        id: USER_ID,
        role: 'USER',
        accountStatus: 'ACTIVE',
      });
      expect(data).toMatchObject({
        accountStatus: 'SUSPENDED',
        statusReason: REASON,
        refreshTokenHash: null,
      });
      expect(data.statusChangedAt).toBeInstanceOf(Date);
    });

    it('nhật ký ghi bằng CHÍNH tx của transaction, đúng hành động / đối tượng / hướng đổi / ngữ cảnh request', async () => {
      const built = build(row());

      await built.service.suspend(
        ADMIN_ID,
        USER_ID,
        { status: 'BANNED', reason: REASON },
        { ip: '203.0.113.7', userAgent: 'UnitTest/1.0' },
      );

      const [client, entry] = auditArgs(built);
      expect(client).toBe(built.tx);
      expect(entry).toEqual({
        actorId: ADMIN_ID,
        action: 'SUSPEND_USER',
        targetType: 'USER',
        targetId: USER_ID,
        reason: REASON,
        meta: { from: 'ACTIVE', to: 'BANNED', shopsSuspended: 0 },
        ip: '203.0.113.7',
        userAgent: 'UnitTest/1.0',
      });
    });

    it('SUSPENDED → BANNED (nâng mức) cũng thu hồi phiên và ghi from/to đúng', async () => {
      const built = build(row({ accountStatus: 'SUSPENDED' }));

      await built.service.suspend(ADMIN_ID, USER_ID, {
        status: 'BANNED',
        reason: REASON,
      });

      expect(updateArgs(built).where).toMatchObject({
        accountStatus: 'SUSPENDED',
      });
      expect(updateArgs(built).data).toMatchObject({
        accountStatus: 'BANNED',
        refreshTokenHash: null,
      });
      expect(auditArgs(built)[1].meta).toEqual({
        from: 'SUSPENDED',
        to: 'BANNED',
        shopsSuspended: 0,
      });
    });

    it.each([
      ['SUSPENDED', 'SUSPENDED'],
      ['BANNED', 'BANNED'],
    ] as const)(
      'ngắt socket của người bị %s và gửi email loại %s',
      async (status, kind) => {
        const built = build(row());

        await built.service.suspend(ADMIN_ID, USER_ID, {
          status,
          reason: REASON,
        });

        expect(built.realtime.disconnectUser).toHaveBeenCalledWith(USER_ID);
        expect(mailArgs(built)[0]).toBe(EMAIL);
        expect(mailArgs(built)[1]).toMatchObject({ kind, reason: REASON });
      },
    );
  });

  describe('mở lại', () => {
    it.each(['SUSPENDED', 'BANNED'] as const)(
      '%s → ACTIVE: xoá lý do khoá, đổi mốc, KHÔNG đụng refreshTokenHash, ghi REACTIVATE_USER',
      async (from) => {
        const built = build(row({ accountStatus: from }));

        await built.service.reactivate(ADMIN_ID, USER_ID, { reason: REASON });

        const { where, data } = updateArgs(built);
        expect(where).toEqual({
          id: USER_ID,
          role: 'USER',
          accountStatus: from,
        });
        expect(data).toMatchObject({
          accountStatus: 'ACTIVE',
          statusReason: null,
        });
        expect(data.statusChangedAt).toBeInstanceOf(Date);
        expect('refreshTokenHash' in data).toBe(false);
        expect(auditArgs(built)[1]).toMatchObject({
          action: 'REACTIVATE_USER',
          reason: REASON,
          meta: { from, to: 'ACTIVE' },
        });
      },
    );

    it('không ngắt socket nào, gửi email loại REACTIVATED kèm link đăng nhập đúng ngôn ngữ', async () => {
      const built = build(row({ accountStatus: 'SUSPENDED', locale: 'en' }));

      await built.service.reactivate(ADMIN_ID, USER_ID, { reason: REASON });

      expect(built.realtime.disconnectUser).not.toHaveBeenCalled();
      expect(mailArgs(built)[1]).toMatchObject({
        kind: 'REACTIVATED',
        locale: 'en',
        loginUrl: 'https://app.example.com/en/login',
      });
    });
  });

  describe('kéo theo shop của chủ tài khoản (Week11.md 3.4)', () => {
    it('khoá: suspendOwnedShops chạy trên CHÍNH tx, SAU UPDATE user và TRƯỚC nhật ký; số shop vào meta và email báo shop tạm ngừng', async () => {
      const built = build(row(), { shopsSuspended: 2 });

      await built.service.suspend(ADMIN_ID, USER_ID, {
        status: 'SUSPENDED',
        reason: REASON,
      });

      expect(built.shopCascade.suspendOwnedShops).toHaveBeenCalledWith(
        built.tx,
        USER_ID,
      );
      expect(
        built.shopCascade.reopenCascadeSuspendedShops,
      ).not.toHaveBeenCalled();
      expect(built.shopCascade.countSuspendedShops).not.toHaveBeenCalled();
      const order = (name: string) => built.calls.indexOf(name);
      expect(order('updateMany')).toBeLessThan(order('cascade'));
      expect(order('cascade')).toBeLessThan(order('audit'));
      expect(auditArgs(built)[1].meta).toEqual({
        from: 'ACTIVE',
        to: 'SUSPENDED',
        shopsSuspended: 2,
      });
      expect(mailArgs(built)[1]).toMatchObject({ shopNotice: 'SUSPENDED' });
    });

    it.each([
      ['ACTIVE', 'SUSPENDED'],
      ['ACTIVE', 'BANNED'],
      ['SUSPENDED', 'BANNED'],
    ] as const)('%s → %s đều kéo theo shop', async (from, status) => {
      const built = build(row({ accountStatus: from }), { shopsSuspended: 1 });

      await built.service.suspend(ADMIN_ID, USER_ID, {
        status,
        reason: REASON,
      });

      expect(built.shopCascade.suspendOwnedShops).toHaveBeenCalledTimes(1);
    });

    it('khoá người không có shop APPROVED nào: meta 0 và email KHÔNG có câu về shop', async () => {
      const built = build(row(), { shopsSuspended: 0 });

      await built.service.suspend(ADMIN_ID, USER_ID, {
        status: 'SUSPENDED',
        reason: REASON,
      });

      expect(auditArgs(built)[1].meta).toMatchObject({ shopsSuspended: 0 });
      expect(mailArgs(built)[1]).toMatchObject({ shopNotice: null });
    });

    it('mở lại từ TẠM KHOÁ: mở lại shop do lần khoá này khoá, truyền đúng mốc vào trạng thái khoá; email báo shop được mở lại', async () => {
      const built = build(row({ accountStatus: 'SUSPENDED' }), {
        shopsReopened: 1,
      });

      await built.service.reactivate(ADMIN_ID, USER_ID, { reason: REASON });

      expect(
        built.shopCascade.reopenCascadeSuspendedShops,
      ).toHaveBeenCalledWith(built.tx, USER_ID, LOCK_STARTED);
      expect(built.shopCascade.suspendOwnedShops).not.toHaveBeenCalled();
      expect(built.shopCascade.countSuspendedShops).not.toHaveBeenCalled();
      expect(auditArgs(built)[1].meta).toEqual({
        from: 'SUSPENDED',
        to: 'ACTIVE',
        shopsReopened: 1,
      });
      expect(mailArgs(built)[1]).toMatchObject({ shopNotice: 'REOPENED' });
    });

    it('mở lại từ TẠM KHOÁ nhưng không shop nào đủ điều kiện mở lại: email KHÔNG có câu về shop', async () => {
      const built = build(row({ accountStatus: 'SUSPENDED' }), {
        shopsReopened: 0,
      });

      await built.service.reactivate(ADMIN_ID, USER_ID, { reason: REASON });

      expect(mailArgs(built)[1]).toMatchObject({ shopNotice: null });
    });

    it('thiếu mốc trạng thái (dữ liệu dựng tay) ⇒ truyền null xuống, không tự bịa mốc', async () => {
      const built = build(
        row({ accountStatus: 'SUSPENDED', statusChangedAt: null }),
      );

      await built.service.reactivate(ADMIN_ID, USER_ID, { reason: REASON });

      expect(
        built.shopCascade.reopenCascadeSuspendedShops,
      ).toHaveBeenCalledWith(built.tx, USER_ID, null);
    });

    it('mở lại từ BỊ CẤM: KHÔNG mở shop nào (chỉ đếm); còn shop bị khoá thì email báo trước, hết thì im lặng', async () => {
      const withShops = build(row({ accountStatus: 'BANNED' }), {
        shopsStillSuspended: 2,
      });
      await withShops.service.reactivate(ADMIN_ID, USER_ID, {
        reason: REASON,
      });

      expect(
        withShops.shopCascade.reopenCascadeSuspendedShops,
      ).not.toHaveBeenCalled();
      expect(withShops.shopCascade.suspendOwnedShops).not.toHaveBeenCalled();
      expect(withShops.shopCascade.countSuspendedShops).toHaveBeenCalledWith(
        withShops.tx,
        USER_ID,
      );
      expect(auditArgs(withShops)[1].meta).toEqual({
        from: 'BANNED',
        to: 'ACTIVE',
        shopsStillSuspended: 2,
      });
      expect(mailArgs(withShops)[1]).toMatchObject({
        shopNotice: 'STILL_SUSPENDED',
      });

      const noShops = build(row({ accountStatus: 'BANNED' }), {
        shopsStillSuspended: 0,
      });
      await noShops.service.reactivate(ADMIN_ID, USER_ID, { reason: REASON });
      expect(mailArgs(noShops)[1]).toMatchObject({ shopNotice: null });
    });

    it('cascade lỗi ⇒ cả request lỗi: không nhật ký, không ngắt socket, không email (tài khoản không bị khoá nửa vời)', async () => {
      const built = build(row());
      built.shopCascade.suspendOwnedShops.mockRejectedValueOnce(
        new Error('cascade down'),
      );

      await expect(
        built.service.suspend(ADMIN_ID, USER_ID, {
          status: 'SUSPENDED',
          reason: REASON,
        }),
      ).rejects.toThrow('cascade down');

      expect(built.audit.record).not.toHaveBeenCalled();
      expect(built.realtime.disconnectUser).not.toHaveBeenCalled();
      expect(built.mail.sendAccountStatusChanged).not.toHaveBeenCalled();
      expect(built.calls).not.toContain('commit');
    });

    it('thua đua (UPDATE user không khớp dòng nào) ⇒ không kéo theo shop nào', async () => {
      const built = build(row(), { updateCount: 0 });

      await expect(
        built.service.suspend(ADMIN_ID, USER_ID, {
          status: 'SUSPENDED',
          reason: REASON,
        }),
      ).rejects.toMatchObject({ code: 'USER_INVALID_TRANSITION' });

      expect(built.shopCascade.suspendOwnedShops).not.toHaveBeenCalled();
    });
  });

  describe('id sai dạng', () => {
    it.each([
      ['chuỗi tuỳ ý', 'abc'],
      ['rỗng', ''],
      [
        'có ký tự NUL (Postgres từ chối nếu lọt tới DB ⇒ 500)',
        `${USER_ID}${String.fromCharCode(0)}`,
      ],
      ['UUID thiếu một ký tự', USER_ID.slice(0, -1)],
    ])(
      '%s ⇒ 404 USER_NOT_FOUND ở cả hai thao tác, KHÔNG mở transaction và không chạm DB',
      async (_name, id) => {
        const built = build(row());

        await expect(
          built.service.suspend(ADMIN_ID, id, {
            status: 'SUSPENDED',
            reason: REASON,
          }),
        ).rejects.toMatchObject({ status: 404, code: 'USER_NOT_FOUND' });
        await expect(
          built.service.reactivate(ADMIN_ID, id, { reason: REASON }),
        ).rejects.toMatchObject({ status: 404, code: 'USER_NOT_FOUND' });

        expect(built.prisma.$transaction).not.toHaveBeenCalled();
        expect(built.tx.user.findUnique).not.toHaveBeenCalled();
      },
    );
  });

  describe('điều kiện bị từ chối trước khi ghi', () => {
    it('người dùng không tồn tại ⇒ 404 USER_NOT_FOUND', async () => {
      const built = build(null);

      await expect(
        built.service.suspend(ADMIN_ID, USER_ID, {
          status: 'SUSPENDED',
          reason: REASON,
        }),
      ).rejects.toMatchObject({ status: 404, code: 'USER_NOT_FOUND' });
      expect(built.tx.user.updateMany).not.toHaveBeenCalled();
    });

    it('tự khoá chính mình ⇒ 409 CANNOT_MODIFY_SELF', async () => {
      const built = build(row({ id: ADMIN_ID, role: 'USER' }));

      await expect(
        built.service.suspend(ADMIN_ID, ADMIN_ID, {
          status: 'SUSPENDED',
          reason: REASON,
        }),
      ).rejects.toMatchObject({ status: 409, code: 'CANNOT_MODIFY_SELF' });
      expect(built.tx.user.updateMany).not.toHaveBeenCalled();
    });

    it('tự khoá mình khi mình cũng là Admin ⇒ vẫn là CANNOT_MODIFY_SELF (không bị che bởi CANNOT_MODIFY_ADMIN)', async () => {
      const built = build(row({ id: ADMIN_ID, role: 'ADMIN' }));

      await expect(
        built.service.suspend(ADMIN_ID, ADMIN_ID, {
          status: 'BANNED',
          reason: REASON,
        }),
      ).rejects.toMatchObject({ code: 'CANNOT_MODIFY_SELF' });
    });

    it.each(['suspend', 'reactivate'] as const)(
      '%s một Admin khác ⇒ 409 CANNOT_MODIFY_ADMIN, không ghi gì',
      async (action) => {
        const built = build(row({ role: 'ADMIN', accountStatus: 'SUSPENDED' }));

        const run =
          action === 'suspend'
            ? built.service.suspend(ADMIN_ID, USER_ID, {
                status: 'BANNED',
                reason: REASON,
              })
            : built.service.reactivate(ADMIN_ID, USER_ID, { reason: REASON });

        await expect(run).rejects.toMatchObject({
          status: 409,
          code: 'CANNOT_MODIFY_ADMIN',
        });
        expect(built.tx.user.updateMany).not.toHaveBeenCalled();
        expect(built.audit.record).not.toHaveBeenCalled();
      },
    );

    it('thua cuộc đua (UPDATE có điều kiện không khớp dòng nào) ⇒ 409 USER_INVALID_TRANSITION, KHÔNG ghi nhật ký, không side-effect', async () => {
      const built = build(row(), { updateCount: 0 });

      await expect(
        built.service.suspend(ADMIN_ID, USER_ID, {
          status: 'SUSPENDED',
          reason: REASON,
        }),
      ).rejects.toMatchObject({ status: 409, code: 'USER_INVALID_TRANSITION' });
      expect(built.audit.record).not.toHaveBeenCalled();
      expect(built.mail.sendAccountStatusChanged).not.toHaveBeenCalled();
      expect(built.realtime.disconnectUser).not.toHaveBeenCalled();
    });
  });

  describe('thứ tự và độ bền của side-effect', () => {
    it('nhật ký TRƯỚC commit; ngắt socket và email chỉ SAU commit', async () => {
      const built = build(row());

      await built.service.suspend(ADMIN_ID, USER_ID, {
        status: 'SUSPENDED',
        reason: REASON,
      });

      expect(built.calls).toEqual([
        'updateMany',
        'cascade',
        'audit',
        'commit',
        'disconnect',
        'mail',
      ]);
    });

    it('ghi nhật ký lỗi ⇒ request lỗi và KHÔNG có side-effect nào (hành động không có dấu vết thì không được xảy ra)', async () => {
      const built = build(row());
      built.audit.record.mockRejectedValueOnce(new Error('audit down'));

      await expect(
        built.service.suspend(ADMIN_ID, USER_ID, {
          status: 'SUSPENDED',
          reason: REASON,
        }),
      ).rejects.toThrow('audit down');
      expect(built.realtime.disconnectUser).not.toHaveBeenCalled();
      expect(built.mail.sendAccountStatusChanged).not.toHaveBeenCalled();
    });

    it('ngắt socket lỗi ⇒ vẫn thành công và VẪN gửi email; lỗi chỉ được log', async () => {
      const built = build(row());
      built.realtime.disconnectUser.mockRejectedValueOnce(new Error('ws down'));

      await expect(
        built.service.suspend(ADMIN_ID, USER_ID, {
          status: 'SUSPENDED',
          reason: REASON,
        }),
      ).resolves.toMatchObject({ id: USER_ID });
      expect(built.mail.sendAccountStatusChanged).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('gửi email lỗi ⇒ vẫn thành công; lỗi chỉ được log', async () => {
      const built = build(row());
      built.mail.sendAccountStatusChanged.mockRejectedValueOnce(
        new Error('resend 500'),
      );

      await expect(
        built.service.suspend(ADMIN_ID, USER_ID, {
          status: 'SUSPENDED',
          reason: REASON,
        }),
      ).resolves.toMatchObject({ id: USER_ID });
      expect(built.realtime.disconnectUser).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('log chỉ có id và hướng đổi — KHÔNG có lý do (văn bản Admin nhập) hay email, kể cả khi side-effect lỗi', async () => {
      const built = build(row());
      built.realtime.disconnectUser.mockRejectedValueOnce(new Error('ws down'));
      built.mail.sendAccountStatusChanged.mockRejectedValueOnce(
        new Error('resend 500'),
      );

      await built.service.suspend(ADMIN_ID, USER_ID, {
        status: 'SUSPENDED',
        reason: REASON,
      });

      const logged = [...callsOf(logSpy), ...callsOf(errorSpy)]
        .flat()
        .map(String)
        .join('\n');
      expect(logged).toContain(USER_ID);
      expect(logged).toContain('ACTIVE -> SUSPENDED');
      expect(logged).not.toContain('CANARY-REASON');
      expect(logged).not.toContain(EMAIL);
    });
  });

  describe('email báo chủ tài khoản', () => {
    it('theo User.locale và tên người nhận, kèm lý do', async () => {
      const built = build(row({ locale: 'en', name: 'John' }));

      await built.service.suspend(ADMIN_ID, USER_ID, {
        status: 'SUSPENDED',
        reason: REASON,
      });

      expect(mailArgs(built)[1]).toMatchObject({
        locale: 'en',
        name: 'John',
        reason: REASON,
        supportEmail: null,
      });
    });

    it('có SUPPORT_EMAIL ⇒ truyền vào email; ENV sai định dạng ⇒ coi như không có', async () => {
      process.env.SUPPORT_EMAIL = '  help@example.com ';
      const withSupport = build(row());
      await withSupport.service.suspend(ADMIN_ID, USER_ID, {
        status: 'SUSPENDED',
        reason: REASON,
      });
      expect(mailArgs(withSupport)[1].supportEmail).toBe('help@example.com');

      process.env.SUPPORT_EMAIL = 'not-an-email';
      const invalid = build(row());
      await invalid.service.suspend(ADMIN_ID, USER_ID, {
        status: 'SUSPENDED',
        reason: REASON,
      });
      expect(mailArgs(invalid)[1].supportEmail).toBeNull();
    });
  });

  it('trả về người dùng sau khi đổi, đúng hình dạng allowlist (không lộ emailVerifiedAt)', async () => {
    const built = build(row());

    const result = await built.service.suspend(ADMIN_ID, USER_ID, {
      status: 'SUSPENDED',
      reason: REASON,
    });

    expect(Object.keys(result).sort()).toEqual([
      'accountStatus',
      'createdAt',
      'email',
      'id',
      'isEmailVerified',
      'name',
      'role',
      'statusChangedAt',
      'statusReason',
    ]);
    expect(result.accountStatus).toBe('SUSPENDED');
  });
});
