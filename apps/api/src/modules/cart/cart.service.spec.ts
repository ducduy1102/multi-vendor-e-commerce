import { PrismaService } from '../../shared/prisma/prisma.service';
import { CartService } from './cart.service';

describe('CartService', () => {
  it('khởi tạo được với PrismaService', () => {
    const service = new CartService({} as unknown as PrismaService);

    expect(service).toBeDefined();
  });
});
