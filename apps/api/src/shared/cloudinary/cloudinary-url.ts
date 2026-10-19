import { CLOUDINARY_UPLOAD_FOLDER } from '@ecommerce/types';

// Đọc `public_id` từ URL ảnh do CHÍNH HỆ THỐNG này tải lên Cloudinary (Week10.md 2.4), dạng secure_url mà
// Cloudinary trả về sau khi upload:
//   https://res.cloudinary.com/<cloud>/image/upload/v1792372175/multi-vendor-ecommerce/gzi6axadd4i5ypmjnkoz.jpg
//   → public_id = "multi-vendor-ecommerce/gzi6axadd4i5ypmjnkoz" (bỏ phần version `v…` và đuôi file).
//
// Cố ý CHẶT: chỉ nhận URL đúng cloud của mình, đúng thư mục upload, không query/fragment, không đoạn
// transformation, id chỉ gồm chữ-số/gạch. Mọi thứ khác (ảnh từ cloud khác như ảnh mẫu `demo`, URL đã biến
// đổi, host lạ, chuỗi người dùng tự nhập) trả null — nơi gọi coi là "không phải ảnh của mình" và KHÔNG BAO GIỜ
// xoá. `images` của biến thể là chuỗi người bán gửi lên nên không được tin: đây là rào chắn để một URL tuỳ ý
// không bao giờ biến thành lệnh xoá một tài nguyên bất kỳ trong tài khoản Cloudinary.
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseManagedImageUrl(
  url: string,
  cloudName: string,
): string | null {
  if (!cloudName) return null;
  const pattern = new RegExp(
    `^https://res\\.cloudinary\\.com/${escapeRegExp(cloudName)}/image/upload/(?:v\\d+/)?(${escapeRegExp(CLOUDINARY_UPLOAD_FOLDER)}/[A-Za-z0-9_-]+)\\.[A-Za-z0-9]+$`,
  );
  return pattern.exec(url)?.[1] ?? null;
}
