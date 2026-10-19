import {
  CLOUDINARY_INCOMING_TRANSFORMATION,
  CLOUDINARY_UPLOAD_FOLDER,
  PRODUCT_IMAGE_MAX_EDGE,
} from '@ecommerce/types';
import { Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { createHash } from 'crypto';
import { CloudinaryService } from './cloudinary.service';

describe('CloudinaryService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('không throw khi thiếu env (bootstrap không sập) — dùng fallback "not-configured"', () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    const service = new CloudinaryService();

    const result = service.generateUploadSignature();

    expect(result.cloudName).toBe('not-configured');
    expect(result.apiKey).toBe('not-configured');
    expect(typeof result.signature).toBe('string');
    expect(result.signature.length).toBeGreaterThan(0);
  });

  it('trả đúng apiKey/cloudName từ env, timestamp là số giây hiện tại', () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    process.env.CLOUDINARY_API_KEY = 'demo-key';
    process.env.CLOUDINARY_API_SECRET = 'demo-secret';
    const service = new CloudinaryService();

    const before = Math.round(Date.now() / 1000);
    const result = service.generateUploadSignature();
    const after = Math.round(Date.now() / 1000);

    expect(result.cloudName).toBe('demo-cloud');
    expect(result.apiKey).toBe('demo-key');
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  it('ký khác nhau khi paramsToSign khác nhau (folder khác nhau ra signature khác nhau)', () => {
    process.env.CLOUDINARY_API_SECRET = 'demo-secret';
    const service = new CloudinaryService();

    // Cùng timestamp nên chỉ khác ở folder — ép Date.now() cố định để so
    // sánh chính xác, tránh flaky vì 2 lệnh gọi rơi vào 2 giây khác nhau.
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const a = service.generateUploadSignature({ folder: 'products' });
    const b = service.generateUploadSignature({ folder: 'shops' });

    expect(a.signature).not.toBe(b.signature);
    jest.restoreAllMocks();
  });

  // Quy tắc ký của Cloudinary: các param (trừ file, api_key, cloud_name, resource_type), sắp theo tên, nối dạng
  // `k=v&k=v`, cộng api_secret rồi băm SHA-1 hex. Tự tính ở đây — không dùng lại hàm của SDK — để test không
  // "đúng vì cùng một hàm sai".
  describe('chữ ký gồm transformation (Week10.md 2.4)', () => {
    const SECRET = 'demo-secret';
    const sha1 = (value: string) =>
      createHash('sha1').update(value).digest('hex');

    beforeEach(() => {
      process.env.CLOUDINARY_API_SECRET = SECRET;
      jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('ký đúng theo quy tắc của Cloudinary với cả folder lẫn transformation', () => {
      const service = new CloudinaryService();

      const { signature } = service.generateUploadSignature({
        folder: CLOUDINARY_UPLOAD_FOLDER,
        transformation: CLOUDINARY_INCOMING_TRANSFORMATION,
      });

      expect(signature).toBe(
        sha1(
          `folder=${CLOUDINARY_UPLOAD_FOLDER}&timestamp=1700000000&transformation=${CLOUDINARY_INCOMING_TRANSFORMATION}${SECRET}`,
        ),
      );
    });

    it('bỏ hoặc đổi transformation thì chữ ký đổi (client không thể nới giới hạn mà vẫn qua)', () => {
      const service = new CloudinaryService();
      const withLimit = service.generateUploadSignature({
        folder: CLOUDINARY_UPLOAD_FOLDER,
        transformation: CLOUDINARY_INCOMING_TRANSFORMATION,
      }).signature;

      const withoutLimit = service.generateUploadSignature({
        folder: CLOUDINARY_UPLOAD_FOLDER,
      }).signature;
      const looserLimit = service.generateUploadSignature({
        folder: CLOUDINARY_UPLOAD_FOLDER,
        transformation: 'c_limit,w_8000,h_8000',
      }).signature;

      expect(withoutLimit).not.toBe(withLimit);
      expect(looserLimit).not.toBe(withLimit);
    });

    it('incoming transformation cùng cỡ với ngưỡng FE nén: c_limit vào khung PRODUCT_IMAGE_MAX_EDGE', () => {
      // Hai nơi cùng suy ra từ một hằng số — test này giữ chúng khỏi bị sửa lệch tay.
      expect(CLOUDINARY_INCOMING_TRANSFORMATION).toBe(
        `c_limit,w_${PRODUCT_IMAGE_MAX_EDGE},h_${PRODUCT_IMAGE_MAX_EDGE},q_auto,f_auto`,
      );
      expect(CLOUDINARY_INCOMING_TRANSFORMATION).toBe(
        'c_limit,w_1600,h_1600,q_auto,f_auto',
      );
    });
  });

  describe('getManagedPublicId (Week10.md 2.4)', () => {
    const url = (cloud: string, id = 'abc123') =>
      `https://res.cloudinary.com/${cloud}/image/upload/v1/multi-vendor-ecommerce/${id}.jpg`;

    it('nhận ảnh đúng cloud trong env, trả public_id', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';

      expect(
        new CloudinaryService().getManagedPublicId(url('demo-cloud')),
      ).toBe('multi-vendor-ecommerce/abc123');
    });

    it('ảnh của cloud khác ⇒ null (không phải ảnh của mình)', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';

      expect(
        new CloudinaryService().getManagedPublicId(url('demo')),
      ).toBeNull();
    });

    it('chưa cấu hình cloud name ⇒ null cho mọi URL (kể cả URL của cloud "not-configured")', () => {
      delete process.env.CLOUDINARY_CLOUD_NAME;

      expect(
        new CloudinaryService().getManagedPublicId(url('not-configured')),
      ).toBeNull();
    });
  });

  describe('deleteImages (Week10.md 2.4)', () => {
    // Tạo spy TRONG beforeEach: `jest.restoreAllMocks()` của các describe khác sẽ gỡ spy tạo lúc khai báo, và khi đó
    // test gọi thật ra mạng với khoá giả.
    let destroy: jest.SpyInstance;

    beforeEach(() => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
      process.env.CLOUDINARY_API_KEY = 'demo-key';
      process.env.CLOUDINARY_API_SECRET = 'demo-secret';
      destroy = jest
        .spyOn(cloudinary.uploader, 'destroy')
        .mockResolvedValue({ result: 'ok' });
      // Lỗi được log bằng Logger của Nest — im lặng trong test.
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('xoá từng public_id kèm invalidate (xoá cả bản đã cache ở CDN)', async () => {
      const result = await new CloudinaryService().deleteImages([
        'multi-vendor-ecommerce/a',
        'multi-vendor-ecommerce/b',
      ]);

      expect(result.failed).toEqual([]);
      expect(destroy).toHaveBeenCalledTimes(2);
      expect(destroy).toHaveBeenCalledWith('multi-vendor-ecommerce/a', {
        invalidate: true,
      });
      expect(destroy).toHaveBeenCalledWith('multi-vendor-ecommerce/b', {
        invalidate: true,
      });
    });

    it('danh sách rỗng: không gọi Cloudinary', async () => {
      const result = await new CloudinaryService().deleteImages([]);

      expect(result.failed).toEqual([]);
      expect(destroy).not.toHaveBeenCalled();
    });

    it('trùng id: chỉ xoá một lần', async () => {
      await new CloudinaryService().deleteImages([
        'multi-vendor-ecommerce/a',
        'multi-vendor-ecommerce/a',
      ]);

      expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('ảnh đã mất sẵn ("not found") coi là đã xoá — idempotent, không tính lỗi', async () => {
      destroy.mockResolvedValue({ result: 'not found' });

      const result = await new CloudinaryService().deleteImages([
        'multi-vendor-ecommerce/a',
      ]);

      expect(result.failed).toEqual([]);
    });

    it('kết quả lạ từ Cloudinary ⇒ tính là lỗi', async () => {
      destroy.mockResolvedValue({ result: 'error' });

      const result = await new CloudinaryService().deleteImages([
        'multi-vendor-ecommerce/a',
      ]);

      expect(result.failed).toEqual(['multi-vendor-ecommerce/a']);
    });

    it('SDK từ chối bằng object thường { message, http_code }: KHÔNG ném, trả id lỗi, các id khác vẫn xoá', async () => {
      destroy.mockImplementation((id: string) =>
        id.endsWith('/bad')
          ? // SDK thật từ chối bằng object thường (không phải Error) — đúng điều test này khoá.
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            Promise.reject({ message: 'Invalid credentials', http_code: 401 })
          : Promise.resolve({ result: 'ok' }),
      );

      const result = await new CloudinaryService().deleteImages([
        'multi-vendor-ecommerce/good',
        'multi-vendor-ecommerce/bad',
        'multi-vendor-ecommerce/good2',
      ]);

      expect(result.failed).toEqual(['multi-vendor-ecommerce/bad']);
      expect(destroy).toHaveBeenCalledTimes(3);
    });

    it('lỗi không có message (undefined/chuỗi) cũng không làm ném', async () => {
      destroy.mockRejectedValue(undefined);

      await expect(
        new CloudinaryService().deleteImages(['multi-vendor-ecommerce/a']),
      ).resolves.toEqual({ failed: ['multi-vendor-ecommerce/a'] });
    });

    it('chạy theo lô: không bao giờ quá 5 lệnh xoá cùng lúc, và vẫn xoá đủ', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      destroy.mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { result: 'ok' };
      });
      const ids = Array.from(
        { length: 12 },
        (_, i) => `multi-vendor-ecommerce/${i}`,
      );

      const result = await new CloudinaryService().deleteImages(ids);

      expect(result.failed).toEqual([]);
      expect(destroy).toHaveBeenCalledTimes(12);
      expect(maxInFlight).toBeLessThanOrEqual(5);
    });

    it('log chỉ chứa id, không chứa bí mật cấu hình', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      destroy.mockRejectedValue({ message: 'boom' });

      await new CloudinaryService().deleteImages(['multi-vendor-ecommerce/a']);

      const logged = warn.mock.calls.map((call) => String(call[0])).join(' ');
      expect(logged).toContain('multi-vendor-ecommerce/a');
      expect(logged).not.toContain('demo-secret');
      expect(logged).not.toContain('demo-key');
    });
  });
});
