import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { parseManagedImageUrl } from './cloudinary-url';

// Số lệnh xoá chạy song song một lần (tránh bắn hàng chục request cùng lúc khi sửa sản phẩm nhiều ảnh).
const DELETE_BATCH_SIZE = 5;

// SDK Cloudinary từ chối bằng object thường `{ message, http_code }`, không phải Error.
const errorMessage = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error);

export interface UploadSignature {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
}

// Signed upload (Week4.md Bước 1.11 hướng b): BE chỉ ký chữ ký, không nhận
// file — FE tự upload thẳng lên Cloudinary kèm chữ ký này. An toàn hơn
// unsigned upload preset (BE kiểm soát được ai/khi nào được phép upload).
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private configured = false;

  // paramsToSign: field khác ngoài timestamp mà FE muốn ký kèm (vd `folder`,
  // `transformation` — incoming transformation, Week10.md 2.4) — phải khớp
  // CHÍNH XÁC (cùng key/value) với params FE gửi lên Cloudinary lúc upload
  // thật, sai 1 ký tự cũng khiến Cloudinary từ chối vì signature không khớp.
  // Chính vì param nằm trong chữ ký mà client không đổi được (vd bỏ hoặc nới
  // transformation) nếu không làm hỏng chữ ký.
  generateUploadSignature(
    paramsToSign: Record<string, string | number> = {},
  ): UploadSignature {
    this.ensureConfigured();

    const timestamp = Math.round(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      { ...paramsToSign, timestamp },
      this.getApiSecret(),
    );

    return {
      signature,
      timestamp,
      apiKey: this.getApiKey(),
      cloudName: this.getCloudName(),
    };
  }

  // `public_id` của ảnh do chính hệ thống tải lên (null nếu URL không phải ảnh của mình — xem
  // cloudinary-url.ts). Nơi gọi chỉ được xoá những gì hàm này nhận ra.
  getManagedPublicId(url: string): string | null {
    return parseManagedImageUrl(url, this.readCloudName());
  }

  // Xoá ảnh khỏi Cloudinary theo public_id (Week10.md 2.4). KHÔNG BAO GIỜ ném: đây là side-effect chạy SAU
  // KHI DB đã ghi xong (rules/backend.md mục 4) — lỗi chỉ để lại một ảnh mồ côi (tốn dung lượng), không được
  // làm hỏng thao tác của người dùng. Idempotent: ảnh đã mất ("not found") coi là đã xoá. Chạy song song theo
  // từng lô nhỏ để không bắn hàng chục request cùng lúc.
  async deleteImages(publicIds: string[]): Promise<{ failed: string[] }> {
    const failed: string[] = [];
    const ids = [...new Set(publicIds)];
    if (ids.length === 0) return { failed };

    try {
      this.ensureConfigured();
    } catch (error) {
      this.logger.error(
        `Cloudinary config failed: ${(error as Error).message}`,
      );
      return { failed: ids };
    }

    for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
      const batch = ids.slice(i, i + DELETE_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(
          (id) =>
            // SDK khai kiểu trả về là `any` — chỉ đọc đúng trường `result` ta cần.
            cloudinary.uploader.destroy(id, { invalidate: true }) as Promise<{
              result?: string;
            }>,
        ),
      );
      results.forEach((result, index) => {
        const id = batch[index];
        const gone =
          result.status === 'fulfilled' &&
          (result.value.result === 'ok' || result.value.result === 'not found');
        if (gone) return;
        failed.push(id);
        // Chỉ log id (không URL/header/khoá) — id là chuỗi ngẫu nhiên không nhạy cảm.
        this.logger.warn(
          `Cloudinary destroy failed for ${id}: ${
            result.status === 'rejected'
              ? errorMessage(result.reason)
              : String(result.value.result)
          }`,
        );
      });
    }
    return { failed };
  }

  // Lazy config (không phải field initializer/constructor) — cùng bài học
  // đã áp dụng cho ResendMailProvider/GoogleStrategy (rules/backend.md mục
  // 8): tránh SDK ngoài làm sập app lúc bootstrap chỉ vì thiếu env, dù ở đây
  // cloudinary.config() bản thân không throw — vẫn giữ nguyên convention
  // lazy-init cho mọi SDK bên thứ 3 trong project, không xét riêng từng SDK
  // có thực sự throw hay không.
  private ensureConfigured(): void {
    if (this.configured) {
      return;
    }
    cloudinary.config({
      cloud_name: this.getCloudName(),
      api_key: this.getApiKey(),
      api_secret: this.getApiSecret(),
    });
    this.configured = true;
  }

  // Khác getCloudName(): rỗng khi chưa cấu hình (không dùng "not-configured") để URL không bao giờ khớp nhầm.
  private readCloudName(): string {
    return process.env.CLOUDINARY_CLOUD_NAME?.trim() || '';
  }

  private getCloudName(): string {
    return process.env.CLOUDINARY_CLOUD_NAME?.trim() || 'not-configured';
  }

  private getApiKey(): string {
    return process.env.CLOUDINARY_API_KEY?.trim() || 'not-configured';
  }

  private getApiSecret(): string {
    return process.env.CLOUDINARY_API_SECRET?.trim() || 'not-configured';
  }
}
