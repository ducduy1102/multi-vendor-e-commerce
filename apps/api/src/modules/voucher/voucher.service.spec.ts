import { PrismaService } from '../../shared/prisma/prisma.service';
import { VoucherService } from './voucher.service';

describe('VoucherService', () => {
  it('khởi tạo được với PrismaService', () => {
    const service = new VoucherService({} as unknown as PrismaService);

    expect(service).toBeDefined();
  });
});
