import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { errorExample } from '../swagger/error-examples';
import { HealthService } from './health.service';

// Route công khai, không guard: nền tảng deploy (Railway/Render) gọi không kèm cookie.
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Health check — API còn sống và kết nối được tới database',
  })
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { status: 'ok' } } },
  })
  @ApiResponse({
    status: 503,
    description: 'Không kết nối được database (hoặc quá thời gian chờ)',
    schema: { example: errorExample('Service unavailable') },
  })
  check() {
    return this.healthService.check();
  }
}
