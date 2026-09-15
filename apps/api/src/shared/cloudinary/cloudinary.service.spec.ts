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
});
