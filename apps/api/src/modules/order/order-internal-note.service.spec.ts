import { Prisma } from '@prisma/client';
import { ORDER_STATUSES_VISIBLE_TO_SELLER } from '@ecommerce/types';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { OrderInternalNoteService } from './order-internal-note.service';

// Logic không cần DB của OrderInternalNoteService (Week11.md 4.4): phạm vi truy cập (đúng shop + đúng bộ lọc "Seller được thấy đơn
// này"), chuỗi rỗng/null ⇒ NULL, 404 không phân biệt, và lỗi ghi của Prisma bị che giá trị. Hành vi thật trên Postgres (đơn của shop
// khác, đơn chưa thanh toán, CHECK ở DB, không lộ ra route khác) do seller-order-internal-note.controller.int-spec.ts kiểm.
const SHOP_ID = 'shop-1';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function setup() {
  const prisma = { order: { updateMany: jest.fn() } };
  prisma.order.updateMany.mockResolvedValue({ count: 1 });
  const service = new OrderInternalNoteService(
    prisma as unknown as PrismaService,
  );
  return { service, prisma };
}

interface UpdateArgs {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}
const firstCallArgs = (prisma: ReturnType<typeof setup>['prisma']) =>
  (prisma.order.updateMany.mock.calls[0] as [UpdateArgs])[0];

describe('OrderInternalNoteService.setInternalNote', () => {
  it('ghi MỘT câu UPDATE có điều kiện: đúng đơn, đúng shop và đúng bộ lọc "Seller được thấy đơn này"', async () => {
    const { service, prisma } = setup();

    await service.setInternalNote(SHOP_ID, ORDER_ID, 'đã gọi khách');

    expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
    const { where } = firstCallArgs(prisma);
    expect(where).toMatchObject({ id: ORDER_ID, shopId: SHOP_ID });
    // Bộ lọc dùng chung: không bao giờ chạm đơn AWAITING_PAYMENT và đơn chưa từng PENDING.
    expect(where).toMatchObject({
      status: { in: [...ORDER_STATUSES_VISIBLE_TO_SELLER] },
      statusHistory: { some: { toStatus: 'PENDING' } },
    });
    expect(
      (where.status as { in: string[] }).in as readonly string[],
    ).not.toContain('AWAITING_PAYMENT');
  });

  it('chỉ ghi cột internalNote — không đụng trạng thái, tiền hay trường nào khác', async () => {
    const { service, prisma } = setup();

    await service.setInternalNote(SHOP_ID, ORDER_ID, 'ghi chú');

    expect(firstCallArgs(prisma).data).toEqual({ internalNote: 'ghi chú' });
  });

  it.each([
    ['chuỗi rỗng', ''],
    ['null', null],
  ])(
    '%s ⇒ xoá ghi chú: lưu NULL, KHÔNG bao giờ lưu chuỗi rỗng',
    async (_name, note) => {
      const { service, prisma } = setup();

      await service.setInternalNote(SHOP_ID, ORDER_ID, note);

      expect(firstCallArgs(prisma).data).toEqual({ internalNote: null });
    },
  );

  it.each(['not-a-uuid', '', `${ORDER_ID}\u0000`, '../etc/passwd'])(
    'id đơn sai dạng (%j) ⇒ cùng 404 và KHÔNG chạm DB (ký tự NUL sẽ làm Postgres báo lỗi ⇒ 500)',
    async (orderId) => {
      const { service, prisma } = setup();

      await expectAppException(service.setInternalNote(SHOP_ID, orderId, 'x'), {
        status: 404,
        code: 'ORDER_NOT_FOUND',
      });

      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    },
  );

  it('không có hàng nào khớp (đơn của shop khác, chưa thanh toán, không tồn tại) ⇒ cùng một 404 ORDER_NOT_FOUND', async () => {
    const { service, prisma } = setup();
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await expectAppException(service.setInternalNote(SHOP_ID, ORDER_ID, 'x'), {
      status: 404,
      code: 'ORDER_NOT_FOUND',
      message: 'Order not found',
    });
  });

  // Prisma in NGUYÊN giá trị đã ghi vào message/stack của PrismaClientValidationError và AllExceptionsFilter log cả stack — nội dung
  // ghi chú (riêng tư) không được lọt ra đường đó (rules/backend.md, Week11.md 2.4).
  it('lỗi ghi mang giá trị đã ghi bị che: lỗi ném ra không chứa nội dung ghi chú', async () => {
    const { service, prisma } = setup();
    const canary = 'GHI-CHU-NOI-BO-CANARY';
    prisma.order.updateMany.mockRejectedValue(
      new Prisma.PrismaClientValidationError(
        `Invalid prisma.order.updateMany() invocation: data: { internalNote: "${canary}" }`,
        { clientVersion: 'test' },
      ),
    );

    const error = await service.setInternalNote(SHOP_ID, ORDER_ID, canary).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(Error);
    const failure = error as Error;
    expect(`${failure.message}\n${failure.stack}`).not.toContain(canary);
    expect(failure.message).toContain('order internal note');
  });

  it('lỗi KHÔNG mang giá trị (vd DB sập) được ném nguyên để chẩn đoán được', async () => {
    const { service, prisma } = setup();
    const down = new Error('connection refused');
    prisma.order.updateMany.mockRejectedValue(down);

    await expect(service.setInternalNote(SHOP_ID, ORDER_ID, 'x')).rejects.toBe(
      down,
    );
  });
});
