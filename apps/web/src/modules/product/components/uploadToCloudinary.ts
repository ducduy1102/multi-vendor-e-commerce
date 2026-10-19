import {
  CLOUDINARY_INCOMING_TRANSFORMATION,
  CLOUDINARY_UPLOAD_FOLDER,
  type UploadSignature,
} from '@ecommerce/types';

interface CloudinaryUploadResponse {
  secure_url: string;
}

// Upload thẳng từ browser lên Cloudinary bằng chữ ký đã ký sẵn (Week4.md
// Bước 1.11 hướng b, Bước 3.8) — không qua BE, BE chỉ ký chứ không nhận file.
//
// `folder` và `transformation` là param ĐÃ KÝ ở BE (product.controller.ts uploadSignature(), ký bằng
// CloudinaryService.generateUploadSignature): PHẢI gửi lên đúng chuỗi đã ký — sai lệch dù 1 ký tự, Cloudinary
// từ chối vì chữ ký không khớp params. Response ký không trả kèm các param đã ký nên không lấy động được; cả
// hai phía đọc CÙNG hằng số ở packages/types để không lệch nhau (rules/backend.md mục 6, "upload ảnh").
// `transformation` là incoming transformation (Week10.md 2.4): Cloudinary thu nhỏ ảnh về khung đã ký trước khi
// lưu — dù trình duyệt đã nén sẵn hay không.
export async function uploadToCloudinary(file: File, signature: UploadSignature): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', signature.apiKey);
  formData.append('timestamp', String(signature.timestamp));
  formData.append('signature', signature.signature);
  formData.append('folder', CLOUDINARY_UPLOAD_FOLDER);
  formData.append('transformation', CLOUDINARY_INCOMING_TRANSFORMATION);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`,
    {
      method: 'POST',
      body: formData,
    },
  );

  if (!response.ok) {
    throw new Error('Upload ảnh lên Cloudinary thất bại');
  }

  const data = (await response.json()) as CloudinaryUploadResponse;
  return data.secure_url;
}
