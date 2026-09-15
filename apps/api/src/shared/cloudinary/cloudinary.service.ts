import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

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
  private configured = false;

  // paramsToSign: field khác ngoài timestamp mà FE muốn ký kèm (vd `folder`)
  // — phải khớp CHÍNH XÁC (cùng key/value) với params FE gửi lên Cloudinary
  // lúc upload thật, sai 1 ký tự cũng khiến Cloudinary từ chối vì signature
  // không khớp.
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
