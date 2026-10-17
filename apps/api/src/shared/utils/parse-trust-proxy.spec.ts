import { Controller, Get, Req } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { parseTrustProxy } from './parse-trust-proxy';

describe('parseTrustProxy', () => {
  it.each<[string | undefined, boolean | number]>([
    [undefined, false],
    ['', false],
    ['   ', false],
    ['false', false],
    ['FALSE', false],
    ['0', false],
    ['abc', false],
    ['-1', false],
    ['1.5', false],
    ['1e3', false],
    ['01', false],
    ['true', true],
    [' TRUE ', true],
    ['1', 1],
    [' 2 ', 2],
    ['10', 10],
  ])('%j -> %j', (raw, expected) => {
    expect(parseTrustProxy(raw)).toBe(expected);
  });
});

@Controller('whoami')
class WhoAmIController {
  @Get()
  whoAmI(@Req() req: Request) {
    return { ip: req.ip };
  }
}

// Kiểm tác dụng THẬT lên `req.ip` của Express (cùng lời gọi `app.set('trust proxy', ...)` như main.ts),
// không chỉ kiểm hàm parse trả đúng giá trị.
describe('trust proxy -> req.ip', () => {
  let app: NestExpressApplication | undefined;

  async function ipSeenBehindProxy(
    trustProxyEnv: string | undefined,
    forwardedFor: string,
  ): Promise<string> {
    const moduleRef = await Test.createTestingModule({
      controllers: [WhoAmIController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', parseTrustProxy(trustProxyEnv));
    await app.init();
    const res = await request(app.getHttpServer())
      .get('/whoami')
      .set('X-Forwarded-For', forwardedFor)
      .expect(200);
    const body = res.body as { ip: string };
    return body.ip;
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it.each([undefined, '', 'false', 'abc'])(
    'TRUST_PROXY=%j (tắt): bỏ qua X-Forwarded-For, req.ip là địa chỉ socket',
    async (env) => {
      const ip = await ipSeenBehindProxy(env, '203.0.113.7');
      expect(ip).not.toBe('203.0.113.7');
      expect(ip).toMatch(/^(::ffff:)?127\.0\.0\.1$|^::1$/);
    },
  );

  it('TRUST_PROXY=1: req.ip là IP mà proxy thấy (X-Forwarded-For có 1 phần tử)', async () => {
    expect(await ipSeenBehindProxy('1', '203.0.113.7')).toBe('203.0.113.7');
  });

  it('TRUST_PROXY=1: client tự thêm IP giả ở đầu danh sách không đổi được kết quả', async () => {
    expect(await ipSeenBehindProxy('1', '198.51.100.9, 203.0.113.7')).toBe(
      '203.0.113.7',
    );
  });

  it('TRUST_PROXY=2: tin thêm một chặng proxy (vd CDN đứng trước nền tảng)', async () => {
    expect(await ipSeenBehindProxy('2', '198.51.100.9, 203.0.113.7')).toBe(
      '198.51.100.9',
    );
  });

  it('TRUST_PROXY=true: tin mọi chặng nên IP giả của client ở đầu danh sách lọt qua (lý do ưu tiên số chặng)', async () => {
    expect(await ipSeenBehindProxy('true', '198.51.100.9, 203.0.113.7')).toBe(
      '198.51.100.9',
    );
  });
});
