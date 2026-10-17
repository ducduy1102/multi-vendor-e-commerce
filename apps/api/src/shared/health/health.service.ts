import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Health check của nền tảng deploy gọi liên tục: DB treo thì phải trả 503 nhanh, không để request chờ
// tới khi nền tảng tự timeout. Prisma không có timeout riêng cho 1 câu lệnh nên dùng Promise.race.
export const HEALTH_DB_TIMEOUT_MS = 3000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.pingDatabase();
    } catch (error) {
      // Lý do thật chỉ ghi log phía server; response không lộ chi tiết hạ tầng (Week9.md 8.1).
      this.logger.warn(
        `Database health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException('Service unavailable');
    }
    return { status: 'ok' };
  }

  private async pingDatabase(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${HEALTH_DB_TIMEOUT_MS}ms`)),
        HEALTH_DB_TIMEOUT_MS,
      );
    });
    try {
      // Câu lệnh thua cuộc đua vẫn chạy tiếp ở nền; Promise.race đã gắn handler cho cả hai nên nếu nó
      // reject muộn cũng không thành unhandled rejection.
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
