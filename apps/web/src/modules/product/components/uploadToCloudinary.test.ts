import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadToCloudinary } from './uploadToCloudinary';

const signature = {
  signature: 'abc123',
  timestamp: 1700000000,
  apiKey: 'key-1',
  cloudName: 'ducduydev',
};

function makeFile(): File {
  return new File(['fake-image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
}

describe('uploadToCloudinary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gọi đúng URL Cloudinary theo cloudName, gửi kèm đủ field đã ký', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ secure_url: 'https://res.cloudinary.com/ducduydev/image/upload/x.jpg' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const url = await uploadToCloudinary(makeFile(), signature);

    expect(url).toBe('https://res.cloudinary.com/ducduydev/image/upload/x.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://api.cloudinary.com/v1_1/ducduydev/image/upload');
    expect(options.method).toBe('POST');

    const body = options.body as FormData;
    expect(body.get('api_key')).toBe('key-1');
    expect(body.get('timestamp')).toBe('1700000000');
    expect(body.get('signature')).toBe('abc123');
    // folder và transformation gửi lên phải khớp CHÍNH XÁC chuỗi đã ký ở BE
    // (product.controller.ts uploadSignature()) — viết thẳng chuỗi ở đây (không import hằng số) để test là
    // lưới an toàn nếu ai đó lỡ đổi hằng số dùng chung mà quên rằng URL ảnh cũ/chữ ký đang chạy phụ thuộc vào nó.
    expect(body.get('folder')).toBe('multi-vendor-ecommerce');
    expect(body.get('transformation')).toBe('c_limit,w_1600,h_1600,q_auto,f_auto');
    expect(body.get('file')).toBeInstanceOf(File);
  });

  it('gửi đúng những field đã ký và không thêm field nào khác ngoài file/api_key/signature', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ secure_url: 'https://res.cloudinary.com/x.jpg' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await uploadToCloudinary(makeFile(), signature);

    const body = fetchMock.mock.calls[0][1].body as FormData;
    // Param thừa không ký (vd thêm `eager`, `tags`) làm Cloudinary từ chối upload; param ký mà thiếu cũng vậy.
    expect([...body.keys()].sort()).toEqual([
      'api_key',
      'file',
      'folder',
      'signature',
      'timestamp',
      'transformation',
    ]);
  });

  it('ném lỗi khi Cloudinary trả về response không ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }),
    );

    await expect(uploadToCloudinary(makeFile(), signature)).rejects.toThrow(
      'Upload ảnh lên Cloudinary thất bại',
    );
  });
});
