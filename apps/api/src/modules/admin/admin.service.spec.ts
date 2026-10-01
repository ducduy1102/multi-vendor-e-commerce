import { Test } from '@nestjs/testing';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  it('khởi tạo được', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: {} }],
    }).compile();

    expect(moduleRef.get(AdminService)).toBeDefined();
  });
});
