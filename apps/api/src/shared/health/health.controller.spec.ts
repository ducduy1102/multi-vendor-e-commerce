import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../interceptors/transform-response.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

// Dựng đúng prefix + interceptor + filter như main.ts để kiểm hình dạng response thật mà nền tảng
// deploy thấy (chỉ gọi service thẳng thì không lộ được lỗi ở các lớp này).
describe('HealthController (HTTP)', () => {
  let app: INestApplication<App>;
  const queryRaw = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    queryRaw.mockReset();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('GET /api/v1/health -> 200 khi DB sống, không cần đăng nhập', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    const body: unknown = res.body;
    expect(body).toEqual({ success: true, data: { status: 'ok' } });
  });

  it('GET /api/v1/health -> 503 khi DB lỗi, đúng format lỗi chuẩn', async () => {
    queryRaw.mockRejectedValue(new Error('connection refused'));

    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);

    const body: unknown = res.body;
    expect(body).toEqual({
      success: false,
      data: null,
      message: 'Service unavailable',
    });
  });
});
