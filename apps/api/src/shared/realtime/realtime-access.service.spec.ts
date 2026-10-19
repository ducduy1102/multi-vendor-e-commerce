import { Logger } from '@nestjs/common';
import { REALTIME_FAILED_HANDSHAKE_MAX } from './realtime.constants';
import { RealtimeAccessService } from './realtime-access.service';

const APP = 'https://app.example.com';
const SOCKET_IP = '10.0.0.1';

describe('RealtimeAccessService', () => {
  const originalEnv = {
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    TRUST_PROXY: process.env.TRUST_PROXY,
  };
  let service: RealtimeAccessService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    process.env.CORS_ORIGIN = APP;
    delete process.env.TRUST_PROXY;
    service = new RealtimeAccessService();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  describe('isOriginAllowed', () => {
    it('khớp CHÍNH XÁC một origin trong CORS_ORIGIN', () => {
      expect(service.isOriginAllowed(APP)).toBe(true);
    });

    it.each([
      ['thiếu Origin', undefined],
      ['Origin rỗng', ''],
      ['khác tên miền', 'https://evil.example'],
      ['subdomain lạ', 'https://app.example.com.evil.example'],
      ['khác giao thức', 'http://app.example.com'],
      ['khác cổng', 'https://app.example.com:8443'],
      ['có dấu "/" cuối', `${APP}/`],
      ['khác hoa thường', 'https://APP.example.com'],
      ['Origin "null" (iframe sandbox, file://)', 'null'],
    ])('từ chối: %s', (_name, origin) => {
      expect(service.isOriginAllowed(origin)).toBe(false);
    });

    it('nhiều origin cách nhau bởi dấu phẩy', () => {
      process.env.CORS_ORIGIN = `${APP}, https://admin.example.com`;

      expect(service.isOriginAllowed(APP)).toBe(true);
      expect(service.isOriginAllowed('https://admin.example.com')).toBe(true);
      expect(service.isOriginAllowed('https://other.example.com')).toBe(false);
    });

    it('CORS_ORIGIN để trống ⇒ về mặc định localhost (cùng danh sách với REST)', () => {
      process.env.CORS_ORIGIN = '';

      expect(service.isOriginAllowed('http://localhost:3000')).toBe(true);
      expect(service.isOriginAllowed(APP)).toBe(false);
    });

    it('đọc danh sách LÚC DÙNG: đổi ENV sau khi dựng service vẫn có hiệu lực', () => {
      expect(service.isOriginAllowed('https://later.example.com')).toBe(false);

      process.env.CORS_ORIGIN = 'https://later.example.com';

      expect(service.isOriginAllowed('https://later.example.com')).toBe(true);
    });
  });

  describe('clientIp', () => {
    it('không đặt TRUST_PROXY ⇒ bỏ qua X-Forwarded-For do client gửi', () => {
      expect(
        service.clientIp({ 'x-forwarded-for': '9.9.9.9' }, SOCKET_IP),
      ).toBe(SOCKET_IP);
    });

    it('TRUST_PROXY=1 ⇒ lấy IP khách từ X-Forwarded-For của proxy', () => {
      process.env.TRUST_PROXY = '1';

      expect(
        service.clientIp(
          { 'x-forwarded-for': '9.9.9.9, 203.0.113.7' },
          SOCKET_IP,
        ),
      ).toBe('203.0.113.7');
    });

    it('header X-Forwarded-For lặp lại (mảng) vẫn đọc được', () => {
      process.env.TRUST_PROXY = '1';

      expect(
        service.clientIp(
          { 'x-forwarded-for': ['9.9.9.9', '203.0.113.7'] },
          SOCKET_IP,
        ),
      ).toBe('203.0.113.7');
    });
  });

  describe('checkUpgradeRequest', () => {
    const request = (origin: string | undefined, forwardedFor?: string) => ({
      headers: {
        ...(origin === undefined ? {} : { origin }),
        ...(forwardedFor === undefined
          ? {}
          : { 'x-forwarded-for': forwardedFor }),
      },
      socket: { remoteAddress: SOCKET_IP },
    });

    it('Origin hợp lệ ⇒ cho qua', () => {
      expect(service.checkUpgradeRequest(request(APP))).toBeNull();
    });

    it('Origin lạ hoặc thiếu ⇒ FORBIDDEN_ORIGIN', () => {
      expect(service.checkUpgradeRequest(request('https://evil.example'))).toBe(
        'FORBIDDEN_ORIGIN',
      );
      expect(service.checkUpgradeRequest(request(undefined))).toBe(
        'FORBIDDEN_ORIGIN',
      );
    });

    it('Origin sai lặp lại quá ngưỡng ⇒ IP bị chặn, kể cả sau đó gửi Origin đúng', () => {
      for (let i = 0; i < REALTIME_FAILED_HANDSHAKE_MAX; i++) {
        expect(
          service.checkUpgradeRequest(request('https://evil.example')),
        ).toBe('FORBIDDEN_ORIGIN');
      }

      expect(service.checkUpgradeRequest(request(APP))).toBe(
        'TOO_MANY_ATTEMPTS',
      );
    });

    it('IP khác không bị ảnh hưởng', () => {
      for (let i = 0; i < REALTIME_FAILED_HANDSHAKE_MAX; i++) {
        service.checkUpgradeRequest(request('https://evil.example'));
      }

      expect(
        service.checkUpgradeRequest({
          headers: { origin: APP },
          socket: { remoteAddress: '10.0.0.2' },
        }),
      ).toBeNull();
    });

    it('không tin X-Forwarded-For khi TRUST_PROXY tắt: đổi IP giả không né được chặn', () => {
      for (let i = 0; i < REALTIME_FAILED_HANDSHAKE_MAX; i++) {
        service.checkUpgradeRequest(
          request('https://evil.example', `1.1.1.${i}`),
        );
      }

      expect(service.checkUpgradeRequest(request(APP, '8.8.8.8'))).toBe(
        'TOO_MANY_ATTEMPTS',
      );
    });

    it('log cảnh báo đúng MỘT lần khi IP chuyển sang bị chặn, không log mỗi request bị chặn', () => {
      for (let i = 0; i < REALTIME_FAILED_HANDSHAKE_MAX + 10; i++) {
        service.checkUpgradeRequest(request('https://evil.example'));
      }

      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('thiếu cả thông tin socket vẫn không ném lỗi', () => {
      expect(
        service.checkUpgradeRequest({ headers: { origin: APP } }),
      ).toBeNull();
    });
  });
});
