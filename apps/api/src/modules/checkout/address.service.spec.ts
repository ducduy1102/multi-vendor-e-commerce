import { NotFoundException } from '@nestjs/common';
import { MAX_ADDRESSES_PER_USER } from '@ecommerce/types';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { expectAppException } from '../../shared/testing/expect-app-exception';
import { AddressService } from './address.service';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'addr-1',
    recipientName: 'Nguyễn Văn A',
    phone: '0912345678',
    line1: '12 Nguyễn Huệ',
    ward: 'Phường Bến Nghé',
    province: 'Hồ Chí Minh',
    isDefault: false,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('AddressService', () => {
  let service: AddressService;
  let prisma: {
    address: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      address: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(row()),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(row()),
        update: jest.fn().mockResolvedValue(row()),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn().mockResolvedValue(row()),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    service = new AddressService(prisma as unknown as PrismaService);
  });

  describe('listMyAddresses', () => {
    it('lọc đúng userId, mặc định trước rồi mới nhất trước', async () => {
      await service.listMyAddresses('user-1');

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        select: expect.any(Object) as unknown,
      });
    });
  });

  describe('createAddress', () => {
    const dto = {
      recipientName: 'A',
      phone: '0912345678',
      line1: 'L1',
      ward: 'W',
      province: 'Hồ Chí Minh',
    };

    it('địa chỉ đầu tiên (count=0) tự làm mặc định', async () => {
      prisma.address.count.mockResolvedValue(0);

      await service.createAddress('user-1', dto);

      expect(prisma.address.create).toHaveBeenCalledWith({
        data: { ...dto, userId: 'user-1', isDefault: true },
        select: expect.any(Object) as unknown,
      });
    });

    it('địa chỉ thứ 2 trở đi KHÔNG tự làm mặc định', async () => {
      prisma.address.count.mockResolvedValue(1);

      await service.createAddress('user-1', dto);

      expect(prisma.address.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isDefault: false }) as unknown,
        }),
      );
    });

    it('vượt trần MAX_ADDRESSES_PER_USER — 409 ADDRESS_LIMIT_REACHED, không tạo', async () => {
      prisma.address.count.mockResolvedValue(MAX_ADDRESSES_PER_USER);

      await expectAppException(service.createAddress('user-1', dto), {
        status: 409,
        code: 'ADDRESS_LIMIT_REACHED',
      });
      expect(prisma.address.create).not.toHaveBeenCalled();
    });

    it('đúng ngưỡng (count = MAX-1) vẫn tạo được', async () => {
      prisma.address.count.mockResolvedValue(MAX_ADDRESSES_PER_USER - 1);

      await expect(service.createAddress('user-1', dto)).resolves.toBeDefined();
    });

    it('không nhận isDefault/userId/shopId từ dto (chỉ field đã canonicalize)', async () => {
      await service.createAddress('user-1', dto);

      const [args] = prisma.address.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(args.data.userId).toBe('user-1');
      expect(Object.keys(args.data).sort()).toEqual(
        [
          'recipientName',
          'phone',
          'line1',
          'ward',
          'province',
          'userId',
          'isDefault',
        ].sort(),
      );
    });
  });

  describe('ownership (update/delete/setDefault)', () => {
    it('địa chỉ của người khác (hoặc không tồn tại) — 404, không update/delete', async () => {
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(
        service.updateAddress('user-1', 'addr-x', { line1: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.address.update).not.toHaveBeenCalled();
    });

    it('mọi query ownership đều lọc theo userId đúng của người gọi', async () => {
      await service.updateAddress('user-1', 'addr-1', { line1: 'x' });

      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: { id: 'addr-1', userId: 'user-1' },
        select: expect.any(Object) as unknown,
      });
    });
  });

  describe('updateAddress', () => {
    it('cập nhật đúng field gửi lên, không đụng isDefault', async () => {
      await service.updateAddress('user-1', 'addr-1', { line1: 'Địa chỉ mới' });

      expect(prisma.address.update).toHaveBeenCalledWith({
        where: { id: 'addr-1' },
        data: { line1: 'Địa chỉ mới' },
        select: expect.any(Object) as unknown,
      });
    });
  });

  describe('deleteAddress', () => {
    it('xoá địa chỉ KHÔNG phải mặc định — không đụng địa chỉ khác', async () => {
      prisma.address.findFirst.mockResolvedValue(row({ isDefault: false }));

      await service.deleteAddress('user-1', 'addr-1');

      expect(prisma.address.delete).toHaveBeenCalledWith({
        where: { id: 'addr-1' },
      });
      expect(prisma.address.findFirst).toHaveBeenCalledTimes(1); // chỉ gọi 1 lần (ownership), không tìm địa chỉ mới
      expect(prisma.address.update).not.toHaveBeenCalled();
    });

    it('xoá địa chỉ MẶC ĐỊNH — địa chỉ tạo gần nhất còn lại trở thành mặc định, trong 1 transaction', async () => {
      prisma.address.findFirst
        .mockResolvedValueOnce(row({ isDefault: true })) // ownership check
        .mockResolvedValueOnce({ id: 'addr-2' }); // địa chỉ gần nhất còn lại (trong transaction)

      await service.deleteAddress('user-1', 'addr-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.address.delete).toHaveBeenCalledWith({
        where: { id: 'addr-1' },
      });
      expect(prisma.address.findFirst).toHaveBeenNthCalledWith(2, {
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      expect(prisma.address.update).toHaveBeenCalledWith({
        where: { id: 'addr-2' },
        data: { isDefault: true },
      });
    });

    it('xoá địa chỉ mặc định DUY NHẤT (không còn địa chỉ nào khác) — không lỗi, không update', async () => {
      prisma.address.findFirst
        .mockResolvedValueOnce(row({ isDefault: true }))
        .mockResolvedValueOnce(null);

      await expect(
        service.deleteAddress('user-1', 'addr-1'),
      ).resolves.toBeUndefined();
      expect(prisma.address.update).not.toHaveBeenCalled();
    });

    it('địa chỉ của người khác — 404, không xoá', async () => {
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteAddress('user-1', 'addr-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.address.delete).not.toHaveBeenCalled();
    });
  });

  describe('setDefaultAddress', () => {
    it('bỏ mặc định cũ TRƯỚC rồi mới đặt mới — cùng 1 transaction, đúng thứ tự', async () => {
      const callOrder: string[] = [];
      prisma.address.updateMany.mockImplementation(() => {
        callOrder.push('updateMany');
        return Promise.resolve({ count: 1 });
      });
      prisma.address.update.mockImplementation(() => {
        callOrder.push('update');
        return Promise.resolve(row({ isDefault: true }));
      });

      await service.setDefaultAddress('user-1', 'addr-1');

      expect(callOrder).toEqual(['updateMany', 'update']);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.address.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isDefault: true, id: { not: 'addr-1' } },
        data: { isDefault: false },
      });
      expect(prisma.address.update).toHaveBeenCalledWith({
        where: { id: 'addr-1' },
        data: { isDefault: true },
        select: expect.any(Object) as unknown,
      });
    });

    it('idempotent — đặt mặc định cho địa chỉ ĐÃ đang mặc định vẫn thành công, không lỗi', async () => {
      prisma.address.findFirst.mockResolvedValue(row({ isDefault: true }));

      await expect(
        service.setDefaultAddress('user-1', 'addr-1'),
      ).resolves.toBeDefined();
    });

    it('địa chỉ của người khác — 404, không đổi gì', async () => {
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(
        service.setDefaultAddress('user-1', 'addr-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
