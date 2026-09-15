import { PrismaService } from '../../shared/prisma/prisma.service';
import { ProductService } from './product.service';

describe('ProductService', () => {
  it('can be instantiated', () => {
    const service = new ProductService({} as PrismaService);
    expect(service).toBeDefined();
  });
});
