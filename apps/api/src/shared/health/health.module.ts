import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

// PrismaService lấy từ PrismaModule (@Global) nên không cần import.
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
