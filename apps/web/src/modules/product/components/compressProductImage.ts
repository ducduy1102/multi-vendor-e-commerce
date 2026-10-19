import {
  PRODUCT_IMAGE_ALLOWED_TYPES,
  PRODUCT_IMAGE_MAX_EDGE,
  PRODUCT_IMAGE_MAX_SOURCE_BYTES,
  PRODUCT_VARIANT_MAX_IMAGES,
} from '@ecommerce/types';

// Xử lý ảnh sản phẩm TRƯỚC khi tải lên Cloudinary (Week10.md 2.4): kiểm lựa chọn file, rồi thu nhỏ + nén về
// WebP ngay trên trình duyệt bằng canvas (không thêm thư viện). Ảnh chụp từ điện thoại thường 4000×3000 px,
// 4–8 MB; trang chỉ hiện ảnh vài trăm px nên tải nguyên bản vừa tốn băng thông người bán vừa tốn dung lượng
// Cloudinary. Cloudinary vẫn là lớp chặn cuối (incoming transformation đã ký, CLOUDINARY_INCOMING_TRANSFORMATION).

// Chất lượng WebP khi nén phía trình duyệt. 0.8 là mức ảnh còn đẹp mà nhỏ hơn JPEG gốc nhiều lần.
const WEBP_QUALITY = 0.8;
const WEBP_MIME = 'image/webp';

export interface ImageSize {
  width: number;
  height: number;
}

// Thu nhỏ vào khung maxEdge × maxEdge, GIỮ TỈ LỆ, KHÔNG bao giờ phóng to (ảnh nhỏ hơn ngưỡng giữ nguyên cỡ).
// Hàm thuần, tách riêng để test được mà không cần canvas/jsdom.
export function computeTargetSize(
  width: number,
  height: number,
  maxEdge: number = PRODUCT_IMAGE_MAX_EDGE,
): ImageSize {
  if (![width, height, maxEdge].every((n) => Number.isFinite(n) && n > 0)) {
    throw new RangeError(`Kích thước ảnh không hợp lệ: ${width}x${height}, maxEdge=${maxEdge}`);
  }
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge) {
    return { width, height };
  }
  const scale = maxEdge / longestEdge;
  // Làm tròn nhưng không để cạnh ngắn của ảnh rất dẹt (vd 20000×1) về 0.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// Lý do từ chối lựa chọn file — nơi hiển thị dịch ra chữ theo ngôn ngữ (i18n), hàm này không biết chữ.
export type ImageRejection =
  { kind: 'type' } | { kind: 'tooLarge'; fileName: string } | { kind: 'tooMany'; max: number };

const isAllowedType = (type: string) =>
  (PRODUCT_IMAGE_ALLOWED_TYPES as readonly string[]).includes(type.toLowerCase());

// Kiểm cả lựa chọn TRƯỚC khi xử lý bất kỳ file nào: một file không hợp lệ thì từ chối cả lượt (không tải lên
// một nửa rồi báo lỗi). `existingCount` là số ảnh biến thể đã có. Dung lượng tính trên file GỐC, trước nén.
export function validateImageSelection(
  files: File[],
  existingCount: number,
): ImageRejection | null {
  if (existingCount + files.length > PRODUCT_VARIANT_MAX_IMAGES) {
    return { kind: 'tooMany', max: PRODUCT_VARIANT_MAX_IMAGES };
  }
  for (const file of files) {
    if (!isAllowedType(file.type)) {
      return { kind: 'type' };
    }
    if (file.size > PRODUCT_IMAGE_MAX_SOURCE_BYTES) {
      return { kind: 'tooLarge', fileName: file.name };
    }
  }
  return null;
}

// Không đọc/giải mã được ảnh (file hỏng, hoặc đuôi ảnh nhưng ruột không phải ảnh).
export class ImageProcessingError extends Error {
  constructor(public readonly fileName: string) {
    super(`Không xử lý được ảnh "${fileName}"`);
    this.name = 'ImageProcessingError';
  }
}

export interface DecodedImage {
  width: number;
  height: number;
  // Giải phóng bộ nhớ của bitmap — ảnh 12 megapixel chiếm ~48 MB RGBA, phải trả lại ngay khi xong.
  release: () => void;
}

// Hai thao tác phụ thuộc trình duyệt tách thành "khe cắm" để unit test thay bằng bản giả (jsdom không có
// createImageBitmap/canvas thật); bản thật chạy ở trình duyệt, được kiểm bằng Playwright.
export interface ImageCodec {
  decode: (file: Blob) => Promise<DecodedImage>;
  // Vẽ ảnh đã giải mã vào đúng `size` rồi mã hoá. null = trình duyệt không mã hoá được kiểu yêu cầu.
  encode: (
    image: DecodedImage,
    size: ImageSize,
    type: string,
    quality: number,
  ) => Promise<Blob | null>;
}

const bitmaps = new WeakMap<DecodedImage, ImageBitmap>();

export const browserImageCodec: ImageCodec = {
  async decode(file) {
    // `from-image`: áp EXIF orientation — ảnh chụp dọc từ điện thoại lưu dạng ngang kèm cờ xoay, bỏ qua cờ
    // này là ảnh bị nằm ngang. Trình duyệt cũ chưa hiểu giá trị đó thì ném TypeError ⇒ rơi về mặc định.
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      bitmap = await createImageBitmap(file);
    }
    const image: DecodedImage = {
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
    bitmaps.set(image, bitmap);
    return image;
  },

  async encode(image, size, type, quality) {
    const bitmap = bitmaps.get(image);
    if (!bitmap) return null;
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  },
};

// "photo.JPG" → "photo.webp"; tên không có đuôi → thêm ".webp".
export function toWebpFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${base}.webp`;
}

// Thu nhỏ về PRODUCT_IMAGE_MAX_EDGE và nén WebP. Trả về file GỐC (không đổi gì) khi nén không có lợi:
//  - trình duyệt không mã hoá được WebP (toBlob rơi về PNG, hoặc null) — Cloudinary vẫn thu nhỏ khi nhận;
//  - ảnh đã nhỏ hơn ngưỡng và nén lại ra file không nhỏ hơn (vd WebP đã tối ưu sẵn).
// Còn khi ảnh PHẢI thu nhỏ thì luôn dùng bản đã thu nhỏ — đúng cỡ quan trọng hơn vài KB.
export async function compressProductImage(
  file: File,
  codec: ImageCodec = browserImageCodec,
): Promise<File> {
  let decoded: DecodedImage;
  try {
    decoded = await codec.decode(file);
  } catch {
    throw new ImageProcessingError(file.name);
  }

  try {
    const target = computeTargetSize(decoded.width, decoded.height);
    const isResized = target.width !== decoded.width || target.height !== decoded.height;
    const blob = await codec.encode(decoded, target, WEBP_MIME, WEBP_QUALITY);

    if (!blob || blob.type !== WEBP_MIME) return file;
    if (!isResized && blob.size >= file.size) return file;
    return new File([blob], toWebpFileName(file.name), {
      type: WEBP_MIME,
      lastModified: Date.now(),
    });
  } catch {
    throw new ImageProcessingError(file.name);
  } finally {
    decoded.release();
  }
}
