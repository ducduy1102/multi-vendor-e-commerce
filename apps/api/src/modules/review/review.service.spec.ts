import { Test } from '@nestjs/testing';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ReviewService } from './review.service';

describe('ReviewService', () => {
  it('khởi tạo được', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ReviewService, { provide: PrismaService, useValue: {} }],
    }).compile();

    expect(moduleRef.get(ReviewService)).toBeInstanceOf(ReviewService);
  });
});
