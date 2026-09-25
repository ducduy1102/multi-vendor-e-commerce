import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

@Injectable()
export class VoucherService {
  constructor(private readonly prisma: PrismaService) {}
}
