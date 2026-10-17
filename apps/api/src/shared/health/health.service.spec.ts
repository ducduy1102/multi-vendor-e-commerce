import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HEALTH_DB_TIMEOUT_MS, HealthService } from './health.service';

describe('HealthService', () => {
  let queryRaw: jest.Mock;
  let warn: jest.SpyInstance;
  let service: HealthService;

  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    queryRaw = jest.fn();
    service = new HealthService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('DB trả lời -> { status: ok }, đã dọn timer', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(service.check()).resolves.toEqual({ status: 'ok' });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('DB báo lỗi -> 503, response không lộ lý do, lý do chỉ nằm trong log', async () => {
    queryRaw.mockRejectedValue(
      new Error("Can't reach database server at db.internal:5432"),
    );

    const error = await service.check().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const exception = error as ServiceUnavailableException;
    expect(exception.getStatus()).toBe(503);
    expect(JSON.stringify(exception.getResponse())).not.toContain(
      'db.internal',
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db.internal'));
    expect(jest.getTimerCount()).toBe(0);
  });

  it('DB treo -> 503 đúng lúc hết HEALTH_DB_TIMEOUT_MS, không sớm hơn', async () => {
    queryRaw.mockReturnValue(new Promise(() => undefined));
    const settled = jest.fn();
    const pending = service.check().catch((e: unknown) => {
      settled();
      return e;
    });

    await jest.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toBeInstanceOf(ServiceUnavailableException);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });
});
