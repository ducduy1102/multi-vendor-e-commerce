import { Prisma } from '@prisma/client';
import { PRODUCT_TAKEDOWN_REASON_MAX_LENGTH } from '@ecommerce/types';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { createFakeNotificationService } from '../../shared/testing/fake-notification-service';
import { ProductModerationService } from './product-moderation.service';

// Luật không cần DB của ProductModerationService (Week11.md 5.7): UPDATE có điều kiện (không đọc-rồi-ghi), nhật ký ghi CÙNG giao dịch với
// thay đổi, thông báo chỉ SAU commit, lý do (văn bản riêng tư) không vào lỗi. Giao dịch thật, CHECK, đua hai Admin và luồng HTTP do
// admin-products.controller.int-spec.ts kiểm trên Postgres.
const ADMIN = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '22222222-2222-4222-8222-222222222222';
const SHOP = '33333333-3333-4333-8333-333333333333';
const REASON = 'Bán hàng cấm: dao bấm tự động lò xo.';

function setup() {
  const calls: string[] = [];
  const tx = {
    product: {
      findUnique: jest.fn().mockResolvedValue({ shopId: SHOP }),
      updateMany: jest.fn().mockImplementation(() => {
        calls.push('update');
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: unknown) => unknown) => {
      calls.push('begin');
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
  const notifications = createFakeNotificationService();
  notifications.notify.mockImplementation(() => {
    calls.push('notify');
    return Promise.resolve();
  });
  const service = new ProductModerationService(
    prisma as unknown as PrismaService,
    audit,
    notifications,
  );
  const input = {
    adminId: ADMIN,
    productId: PRODUCT,
    reason: REASON,
    context: { ip: '203.0.113.7' },
  };
  return { service, prisma, tx, audit, notifications, calls, input };
}

describe('ProductModerationService.takeDown', () => {
  it('UPDATE có điều kiện status <> TAKEN_DOWN, đặt ba cột gỡ, rồi ghi nhật ký TAKE_DOWN_PRODUCT trong CÙNG giao dịch', async () => {
    const { service, tx, audit, calls, input } = setup();

    const result = await service.takeDown(input);

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: PRODUCT, status: { not: 'TAKEN_DOWN' } },
      data: {
        status: 'TAKEN_DOWN',
        takenDownAt: expect.any(Date) as Date,
        takenDownById: ADMIN,
        takenDownReason: REASON,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorId: ADMIN,
      action: 'TAKE_DOWN_PRODUCT',
      targetType: 'PRODUCT',
      targetId: PRODUCT,
      reason: REASON,
      meta: { shopId: SHOP },
      ip: '203.0.113.7',
    });
    expect(calls.slice(0, 4)).toEqual(['begin', 'update', 'audit', 'commit']);
    expect(result).toEqual({
      product: {
        id: PRODUCT,
        status: 'TAKEN_DOWN',
        takenDownAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) as string,
      },
    });
  });

  it('báo chủ shop SAU commit, chỉ bằng id sản phẩm và lý do đã ghi', async () => {
    const { service, notifications, calls, input } = setup();

    await service.takeDown(input);

    expect(notifications.notify).toHaveBeenCalledWith({
      kind: 'PRODUCT_TAKEN_DOWN',
      productId: PRODUCT,
      reason: REASON,
    });
    expect(calls.indexOf('notify')).toBeGreaterThan(calls.indexOf('commit'));
  });

  it('sản phẩm không tồn tại ⇒ 404 PRODUCT_NOT_FOUND, không ghi gì, không nhật ký, không thông báo', async () => {
    const { service, tx, audit, notifications, input } = setup();
    tx.product.findUnique.mockResolvedValue(null);

    await expectAppException(service.takeDown(input), {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });

    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('đã bị gỡ (UPDATE không khớp hàng nào — Admin khác thắng đua) ⇒ 409 PRODUCT_ALREADY_TAKEN_DOWN, không nhật ký lần hai, không thông báo lần hai', async () => {
    const { service, tx, audit, notifications, input } = setup();
    tx.product.updateMany.mockResolvedValue({ count: 0 });

    await expectAppException(service.takeDown(input), {
      status: 409,
      code: 'PRODUCT_ALREADY_TAKEN_DOWN',
    });

    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('nhật ký lỗi ⇒ giao dịch rollback (lỗi lan ra) và không báo chủ shop', async () => {
    const { service, audit, notifications, calls, input } = setup();
    audit.record.mockRejectedValue(new Error('audit down'));

    await expect(service.takeDown(input)).rejects.toThrow();

    expect(calls).not.toContain('commit');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('lỗi ghi của Prisma mang nguyên giá trị đã ghi (lý do Admin) bị che: lỗi ném ra không chứa lý do', async () => {
    const { service, tx, input } = setup();
    tx.product.updateMany.mockRejectedValue(
      new Prisma.PrismaClientValidationError(
        `Invalid value for argument takenDownReason: ${REASON}`,
        { clientVersion: '6.19.3' },
      ),
    );

    const error = await service.takeDown(input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(
      JSON.stringify([(error as Error).message, (error as Error).stack]),
    ).not.toContain(REASON);
  });

  it('cận lý do trong hợp đồng khớp CHECK ở DB (500)', () => {
    expect(PRODUCT_TAKEDOWN_REASON_MAX_LENGTH).toBe(500);
  });
});

describe('ProductModerationService.restore', () => {
  it('UPDATE có điều kiện status = TAKEN_DOWN, về NHÁP và xoá cả ba cột gỡ, rồi ghi nhật ký RESTORE_PRODUCT trong CÙNG giao dịch', async () => {
    const { service, tx, audit, calls, input } = setup();

    const result = await service.restore(input);

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: PRODUCT, status: 'TAKEN_DOWN' },
      data: {
        status: 'DRAFT',
        takenDownAt: null,
        takenDownById: null,
        takenDownReason: null,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorId: ADMIN,
      action: 'RESTORE_PRODUCT',
      targetType: 'PRODUCT',
      targetId: PRODUCT,
      reason: REASON,
      meta: { shopId: SHOP },
      ip: '203.0.113.7',
    });
    expect(calls.slice(0, 4)).toEqual(['begin', 'update', 'audit', 'commit']);
    expect(result).toEqual({
      product: { id: PRODUCT, status: 'DRAFT', takenDownAt: null },
    });
  });

  it('không báo chủ shop khi khôi phục', async () => {
    const { service, notifications, input } = setup();

    await service.restore(input);

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('không ở TAKEN_DOWN (UPDATE không khớp hàng nào) ⇒ 409 PRODUCT_NOT_TAKEN_DOWN, không nhật ký', async () => {
    const { service, tx, audit, input } = setup();
    tx.product.updateMany.mockResolvedValue({ count: 0 });

    await expectAppException(service.restore(input), {
      status: 409,
      code: 'PRODUCT_NOT_TAKEN_DOWN',
    });

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('sản phẩm không tồn tại ⇒ 404 PRODUCT_NOT_FOUND, không ghi gì', async () => {
    const { service, tx, audit, input } = setup();
    tx.product.findUnique.mockResolvedValue(null);

    await expectAppException(service.restore(input), {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });

    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

// Chấp nhận kháng nghị (Week11.md 5.8) gọi `restoreInTx` TRONG transaction của quyết định và ghi chú là tuỳ chọn.
describe('ProductModerationService.restoreInTx', () => {
  it('không có lý do ⇒ dòng nhật ký RESTORE_PRODUCT không có `reason` (không bịa lý do), vẫn khôi phục về NHÁP', async () => {
    const { service, tx, audit } = setup();

    await service.restoreInTx(tx as never, {
      adminId: ADMIN,
      productId: PRODUCT,
      context: { ip: '203.0.113.7' },
    });

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: PRODUCT, status: 'TAKEN_DOWN' },
      data: {
        status: 'DRAFT',
        takenDownAt: null,
        takenDownById: null,
        takenDownReason: null,
      },
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    const [[, entry]] = audit.record.mock.calls as [
      unknown,
      Record<string, unknown>,
    ][];
    expect(entry).not.toHaveProperty('reason');
    expect(entry).toMatchObject({
      action: 'RESTORE_PRODUCT',
      targetId: PRODUCT,
      meta: { shopId: SHOP },
    });
  });

  it('có lý do ⇒ ghi lý do đó vào nhật ký', async () => {
    const { service, tx, audit } = setup();

    await service.restoreInTx(tx as never, {
      adminId: ADMIN,
      productId: PRODUCT,
      reason: REASON,
      context: {},
    });

    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reason: REASON }),
    );
  });

  it('không tự mở giao dịch và không báo ai: nơi gọi giữ giao dịch của mình', async () => {
    const { service, tx, prisma, notifications } = setup();

    await service.restoreInTx(tx as never, {
      adminId: ADMIN,
      productId: PRODUCT,
      context: {},
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
