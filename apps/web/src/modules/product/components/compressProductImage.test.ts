import {
  PRODUCT_IMAGE_MAX_EDGE,
  PRODUCT_IMAGE_MAX_SOURCE_BYTES,
  PRODUCT_VARIANT_MAX_IMAGES,
} from '@ecommerce/types';
import { describe, expect, it, vi } from 'vitest';

import {
  compressProductImage,
  computeTargetSize,
  ImageProcessingError,
  toWebpFileName,
  validateImageSelection,
  type ImageCodec,
} from './compressProductImage';

describe('computeTargetSize', () => {
  it('ảnh ngang lớn hơn ngưỡng: cạnh dài về đúng ngưỡng, giữ tỉ lệ', () => {
    expect(computeTargetSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
  });

  it('ảnh dọc (chụp điện thoại): cạnh dài là chiều cao', () => {
    expect(computeTargetSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });

  it('ảnh vuông lớn', () => {
    expect(computeTargetSize(5000, 5000)).toEqual({ width: 1600, height: 1600 });
  });

  it('ảnh nhỏ hơn ngưỡng: GIỮ NGUYÊN cỡ, không phóng to', () => {
    expect(computeTargetSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(computeTargetSize(100, 50)).toEqual({ width: 100, height: 50 });
  });

  it('đúng bằng ngưỡng: không đổi (biên)', () => {
    expect(computeTargetSize(1600, 900)).toEqual({ width: 1600, height: 900 });
    expect(computeTargetSize(900, 1600)).toEqual({ width: 900, height: 1600 });
  });

  it('hơn ngưỡng đúng 1 px: thu nhỏ, cạnh dài về đúng ngưỡng', () => {
    const size = computeTargetSize(1601, 1000);

    expect(size.width).toBe(1600);
    expect(size.height).toBe(999);
  });

  it('ảnh panorama rất dẹt: cạnh ngắn không về 0', () => {
    expect(computeTargetSize(20000, 1)).toEqual({ width: 1600, height: 1 });
    expect(computeTargetSize(1, 20000)).toEqual({ width: 1, height: 1600 });
  });

  it('làm tròn về số nguyên', () => {
    const { width, height } = computeTargetSize(3333, 2222);

    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
    expect(Math.max(width, height)).toBe(1600);
  });

  it('giữ tỉ lệ khung hình (sai số làm tròn ≤ 1 px)', () => {
    const { width, height } = computeTargetSize(4032, 3024);

    expect(Math.abs(width / height - 4032 / 3024)).toBeLessThan(1 / height);
  });

  it('maxEdge tuỳ chọn', () => {
    expect(computeTargetSize(1000, 500, 200)).toEqual({ width: 200, height: 100 });
  });

  it('mặc định dùng đúng PRODUCT_IMAGE_MAX_EDGE dùng chung với BE', () => {
    expect(computeTargetSize(PRODUCT_IMAGE_MAX_EDGE * 2, PRODUCT_IMAGE_MAX_EDGE).width).toBe(
      PRODUCT_IMAGE_MAX_EDGE,
    );
  });

  it.each([
    [0, 100],
    [100, 0],
    [-5, 100],
    [Number.NaN, 100],
    [100, Number.POSITIVE_INFINITY],
  ])('kích thước không hợp lệ (%p × %p): ném RangeError, không trả số vô nghĩa', (w, h) => {
    expect(() => computeTargetSize(w, h)).toThrow(RangeError);
  });

  it('maxEdge không hợp lệ: ném RangeError', () => {
    expect(() => computeTargetSize(100, 100, 0)).toThrow(RangeError);
  });
});

describe('toWebpFileName', () => {
  it.each([
    ['photo.jpg', 'photo.webp'],
    ['photo.JPG', 'photo.webp'],
    ['a.b.c.png', 'a.b.c.webp'],
    ['noext', 'noext.webp'],
    ['.hidden', '.hidden.webp'],
    ['x.webp', 'x.webp'],
  ])('%s → %s', (input, expected) => {
    expect(toWebpFileName(input)).toBe(expected);
  });
});

function fileOf(name: string, type: string, size = 1000): File {
  const file = new File(['x'], name, { type });
  // Dung lượng giả: dựng File thật nặng hàng MB trong test vừa chậm vừa tốn bộ nhớ.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('validateImageSelection', () => {
  it('ảnh hợp lệ: không có lý do từ chối', () => {
    expect(validateImageSelection([fileOf('a.jpg', 'image/jpeg')], 0)).toBeNull();
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'IMAGE/JPEG'])('chấp nhận %s', (type) => {
    expect(validateImageSelection([fileOf('a', type)], 0)).toBeNull();
  });

  it.each([
    ['gif', 'image/gif'],
    ['svg (có thể chứa script)', 'image/svg+xml'],
    ['avif', 'image/avif'],
    ['bmp', 'image/bmp'],
    ['pdf', 'application/pdf'],
    ['không rõ kiểu', ''],
  ])('từ chối %s', (_label, type) => {
    expect(validateImageSelection([fileOf('a', type)], 0)).toEqual({ kind: 'type' });
  });

  it('đúng giới hạn dung lượng gốc: hợp lệ; hơn 1 byte: từ chối kèm tên file', () => {
    expect(
      validateImageSelection([fileOf('a.jpg', 'image/jpeg', PRODUCT_IMAGE_MAX_SOURCE_BYTES)], 0),
    ).toBeNull();
    expect(
      validateImageSelection(
        [fileOf('big.jpg', 'image/jpeg', PRODUCT_IMAGE_MAX_SOURCE_BYTES + 1)],
        0,
      ),
    ).toEqual({ kind: 'tooLarge', fileName: 'big.jpg' });
  });

  it('đủ giới hạn số ảnh (đã có + chọn thêm = tối đa): hợp lệ', () => {
    const files = [fileOf('a.jpg', 'image/jpeg'), fileOf('b.jpg', 'image/jpeg')];

    expect(validateImageSelection(files, PRODUCT_VARIANT_MAX_IMAGES - 2)).toBeNull();
  });

  it('vượt 1 ảnh: tooMany kèm số tối đa', () => {
    const files = [fileOf('a.jpg', 'image/jpeg'), fileOf('b.jpg', 'image/jpeg')];

    expect(validateImageSelection(files, PRODUCT_VARIANT_MAX_IMAGES - 1)).toEqual({
      kind: 'tooMany',
      max: PRODUCT_VARIANT_MAX_IMAGES,
    });
  });

  it('đã đủ ảnh mà vẫn chọn thêm: tooMany', () => {
    expect(
      validateImageSelection([fileOf('a.jpg', 'image/jpeg')], PRODUCT_VARIANT_MAX_IMAGES),
    ).toEqual({ kind: 'tooMany', max: PRODUCT_VARIANT_MAX_IMAGES });
  });

  it('một lượt chọn nhiều file chỉ cần MỘT file sai là từ chối cả lượt (không xử lý nửa chừng)', () => {
    const files = [
      fileOf('ok.jpg', 'image/jpeg'),
      fileOf('bad.gif', 'image/gif'),
      fileOf('ok2.png', 'image/png'),
    ];

    expect(validateImageSelection(files, 0)).toEqual({ kind: 'type' });
  });

  it('vừa quá số ảnh vừa sai kiểu: báo số ảnh trước (kiểm rẻ nhất, không cần đọc từng file)', () => {
    const files = Array.from({ length: PRODUCT_VARIANT_MAX_IMAGES + 1 }, () =>
      fileOf('a.gif', 'image/gif'),
    );

    expect(validateImageSelection(files, 0)).toEqual({
      kind: 'tooMany',
      max: PRODUCT_VARIANT_MAX_IMAGES,
    });
  });

  it('chọn rỗng: không có gì để từ chối', () => {
    expect(validateImageSelection([], 3)).toBeNull();
  });
});

// Bản giả của hai thao tác phụ thuộc trình duyệt. `encode` trả blob có kích thước/kiểu chỉ định.
function fakeCodec(options: {
  width: number;
  height: number;
  encoded?: { size: number; type: string } | null;
  decodeError?: boolean;
  encodeError?: boolean;
}): ImageCodec & { release: ReturnType<typeof vi.fn>; encode: ReturnType<typeof vi.fn> } {
  const release = vi.fn();
  const encode = vi.fn(async () => {
    if (options.encodeError) throw new Error('canvas lỗi');
    const encoded =
      options.encoded === undefined ? { size: 100, type: 'image/webp' } : options.encoded;
    return encoded ? new Blob([new Uint8Array(encoded.size)], { type: encoded.type }) : null;
  });
  return {
    release,
    encode,
    decode: vi.fn(async () => {
      if (options.decodeError) throw new Error('không giải mã được');
      return { width: options.width, height: options.height, release };
    }),
  };
}

describe('compressProductImage', () => {
  it('ảnh lớn: thu nhỏ về 1600 px, mã hoá WebP chất lượng 0.8, đổi tên .webp', async () => {
    const codec = fakeCodec({
      width: 4000,
      height: 3000,
      encoded: { size: 300, type: 'image/webp' },
    });
    const source = fileOf('IMG_0001.JPG', 'image/jpeg', 6_000_000);

    const result = await compressProductImage(source, codec);

    expect(codec.encode).toHaveBeenCalledWith(
      expect.objectContaining({ width: 4000, height: 3000 }),
      { width: 1600, height: 1200 },
      'image/webp',
      0.8,
    );
    expect(result).not.toBe(source);
    expect(result.name).toBe('IMG_0001.webp');
    expect(result.type).toBe('image/webp');
    expect(result.size).toBe(300);
  });

  it('ảnh PHẢI thu nhỏ thì luôn dùng bản thu nhỏ, kể cả khi (hiếm) nó không nhẹ hơn file gốc', async () => {
    const codec = fakeCodec({
      width: 4000,
      height: 3000,
      encoded: { size: 9000, type: 'image/webp' },
    });

    const result = await compressProductImage(fileOf('a.png', 'image/png', 5000), codec);

    expect(result.type).toBe('image/webp');
    expect(result.size).toBe(9000);
  });

  it('ảnh đã nhỏ hơn ngưỡng và nén ra nhẹ hơn: dùng bản nén, KHÔNG phóng to', async () => {
    const codec = fakeCodec({
      width: 800,
      height: 600,
      encoded: { size: 40_000, type: 'image/webp' },
    });

    const result = await compressProductImage(fileOf('a.jpg', 'image/jpeg', 200_000), codec);

    expect(codec.encode).toHaveBeenCalledWith(
      expect.anything(),
      { width: 800, height: 600 },
      'image/webp',
      0.8,
    );
    expect(result.size).toBe(40_000);
  });

  it('ảnh đã nhỏ và nén ra KHÔNG nhẹ hơn (WebP đã tối ưu sẵn): giữ nguyên file gốc, cùng đối tượng', async () => {
    const codec = fakeCodec({
      width: 800,
      height: 600,
      encoded: { size: 50_000, type: 'image/webp' },
    });
    const source = fileOf('a.webp', 'image/webp', 50_000);

    const result = await compressProductImage(source, codec);

    expect(result).toBe(source);
  });

  it('trình duyệt không mã hoá được WebP (toBlob rơi về PNG): giữ file gốc', async () => {
    const codec = fakeCodec({
      width: 4000,
      height: 3000,
      encoded: { size: 999, type: 'image/png' },
    });
    const source = fileOf('a.jpg', 'image/jpeg', 6_000_000);

    expect(await compressProductImage(source, codec)).toBe(source);
  });

  it('toBlob trả null: giữ file gốc', async () => {
    const codec = fakeCodec({ width: 4000, height: 3000, encoded: null });
    const source = fileOf('a.jpg', 'image/jpeg', 6_000_000);

    expect(await compressProductImage(source, codec)).toBe(source);
  });

  it('không giải mã được: ném ImageProcessingError kèm tên file, không gọi encode', async () => {
    const codec = fakeCodec({ width: 1, height: 1, decodeError: true });

    const error = await compressProductImage(fileOf('hong.jpg', 'image/jpeg'), codec).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ImageProcessingError);
    expect((error as ImageProcessingError).fileName).toBe('hong.jpg');
    expect(codec.encode).not.toHaveBeenCalled();
  });

  it('encode ném lỗi: bọc thành ImageProcessingError', async () => {
    const codec = fakeCodec({ width: 4000, height: 3000, encodeError: true });

    await expect(compressProductImage(fileOf('a.jpg', 'image/jpeg'), codec)).rejects.toBeInstanceOf(
      ImageProcessingError,
    );
  });

  it('kích thước giải mã vô nghĩa (0×0): ImageProcessingError, không phải RangeError rò ra ngoài', async () => {
    const codec = fakeCodec({ width: 0, height: 0 });

    await expect(compressProductImage(fileOf('a.jpg', 'image/jpeg'), codec)).rejects.toBeInstanceOf(
      ImageProcessingError,
    );
  });

  it('LUÔN giải phóng bitmap: thành công, giữ gốc, và cả khi encode lỗi', async () => {
    const ok = fakeCodec({ width: 4000, height: 3000 });
    await compressProductImage(fileOf('a.jpg', 'image/jpeg', 6_000_000), ok);
    expect(ok.release).toHaveBeenCalledTimes(1);

    const kept = fakeCodec({
      width: 800,
      height: 600,
      encoded: { size: 50_000, type: 'image/webp' },
    });
    await compressProductImage(fileOf('a.webp', 'image/webp', 50_000), kept);
    expect(kept.release).toHaveBeenCalledTimes(1);

    const failing = fakeCodec({ width: 4000, height: 3000, encodeError: true });
    await compressProductImage(fileOf('a.jpg', 'image/jpeg'), failing).catch(() => undefined);
    expect(failing.release).toHaveBeenCalledTimes(1);
  });

  it('không giải mã được thì không có gì để giải phóng', async () => {
    const codec = fakeCodec({ width: 1, height: 1, decodeError: true });

    await compressProductImage(fileOf('a.jpg', 'image/jpeg'), codec).catch(() => undefined);

    expect(codec.release).not.toHaveBeenCalled();
  });
});
