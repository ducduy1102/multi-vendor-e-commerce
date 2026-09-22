import type { UploadSignature } from '@ecommerce/types';

// Folder PHẢI khớp chính xác chuỗi đã ký ở BE
// (apps/api/src/modules/product/product.controller.ts uploadSignature(),
// gọi CloudinaryService.generateUploadSignature({ folder: '...' })) — sai
// lệch dù 1 ký tự, Cloudinary sẽ từ chối vì signature không khớp params gửi
// lên thật. Không có cách nào lấy giá trị này động từ response
// getUploadSignature (BE không trả kèm folder đã ký), nên phải hard-code
// đúng giá trị đó ở đây, giữ đồng bộ thủ công giữa 2 phía.
const CLOUDINARY_UPLOAD_FOLDER = 'multi-vendor-ecommerce';

interface CloudinaryUploadResponse {
  secure_url: string;
}

// Upload thẳng từ browser lên Cloudinary bằng chữ ký đã ký sẵn (Week4.md
// Bước 1.11 hướng b, Bước 3.8) — không qua BE, BE chỉ ký chứ không nhận file.
export async function uploadToCloudinary(file: File, signature: UploadSignature): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', signature.apiKey);
  formData.append('timestamp', String(signature.timestamp));
  formData.append('signature', signature.signature);
  formData.append('folder', CLOUDINARY_UPLOAD_FOLDER);

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
