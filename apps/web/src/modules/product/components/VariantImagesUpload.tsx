'use client';

import {
  PRODUCT_IMAGE_ALLOWED_TYPES,
  PRODUCT_IMAGE_MAX_SOURCE_BYTES,
  PRODUCT_VARIANT_MAX_IMAGES,
} from '@ecommerce/types';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { useRef, useState, type ChangeEvent } from 'react';

import { Button } from '@/shared/components/ui/button';
import { useUploadSignature } from '../hooks/useUploadSignature';
import {
  compressProductImage,
  ImageProcessingError,
  validateImageSelection,
  type ImageRejection,
} from './compressProductImage';
import { uploadToCloudinary } from './uploadToCloudinary';

// Kích thước tối đa hiển thị cho người bán theo MB (số nguyên), suy từ hằng số dùng chung với kiểm tra thật.
const MAX_SOURCE_MB = PRODUCT_IMAGE_MAX_SOURCE_BYTES / (1024 * 1024);

// Tên file do người dùng chọn đưa vào thông báo — cắt gọn để tên dài không đẩy vỡ bố cục dòng biến thể.
const MAX_SHOWN_FILE_NAME = 40;
const shortFileName = (name: string) =>
  name.length > MAX_SHOWN_FILE_NAME ? `${name.slice(0, MAX_SHOWN_FILE_NAME - 1)}…` : name;

// Lỗi đang hiện: lỗi kiểm lựa chọn (ImageRejection), không đọc được file ảnh, hoặc tải lên thất bại (chung).
type UploadError = ImageRejection | { kind: 'process'; fileName: string } | { kind: 'upload' };

interface VariantImagesUploadProps {
  value: string[];
  onChange: (urls: string[]) => void;
  uploadLabel: string;
  uploadingLabel: string;
  removeLabel: string;
  moveUpLabel: string;
  moveDownLabel: string;
  errorLabel: string;
}

// Nhiều ảnh/variant (Week5.md Bước 1.3/2.12/3.13, thay VariantImageUpload cũ
// chỉ nhận 1 ảnh). `value`/`onChange` là mảng URL đã ký sẵn qua signed
// upload, thứ tự mảng CHÍNH LÀ `position` (BE suy position từ thứ tự mảng
// request, không nhận field position riêng — xem productVariantInputSchema ở
// packages/types) — nút lên/xuống chỉ hoán đổi vị trí trong mảng, không có
// state `position` riêng nào khác cần đồng bộ. Trạng thái uploading/lỗi giữ
// RIÊNG cho từng instance (mỗi variant 1 component), giống VariantImageUpload
// cũ.
export function VariantImagesUpload({
  value,
  onChange,
  uploadLabel,
  uploadingLabel,
  removeLabel,
  moveUpLabel,
  moveDownLabel,
  errorLabel,
}: VariantImagesUploadProps) {
  const t = useTranslations('product');
  const uploadSignature = useUploadSignature();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isFull = value.length >= PRODUCT_VARIANT_MAX_IMAGES;

  async function handleFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Reset ngay để chọn lại đúng bộ file cũ (vd upload lỗi, thử lại) vẫn
    // bắn sự kiện change — input giữ nguyên value cũ thì browser coi là
    // không đổi, không gọi lại onChange.
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    // Kiểm CẢ lượt chọn trước khi xử lý bất kỳ file nào (Week10.md 2.4): định dạng, dung lượng gốc, số ảnh.
    // `accept` của ô chọn file chỉ là gợi ý của trình duyệt — người dùng vẫn chọn được "mọi tệp".
    const rejection = validateImageSelection(files, value.length);
    if (rejection) {
      setError(rejection);
      return;
    }

    setError(null);
    setIsUploading(true);
    try {
      const uploadedUrls: string[] = [];
      // Nén + ký + upload TUẦN TỰ từng file (không Promise.all) — mỗi file cần 1
      // chữ ký riêng (useUploadSignature không cache, đúng lý do đã ghi ở
      // VariantImageUpload cũ), tuần tự cũng đủ nhanh với số ảnh/variant
      // thực tế (vài ảnh), không cần phức tạp hoá bằng song song; tuần tự còn giữ bộ nhớ thấp
      // (mỗi lúc chỉ một bitmap lớn được giải mã).
      for (const file of files) {
        const prepared = await compressProductImage(file);
        const signature = await uploadSignature.mutateAsync();
        const url = await uploadToCloudinary(prepared, signature);
        uploadedUrls.push(url);
      }
      onChange([...value, ...uploadedUrls]);
    } catch (caught) {
      setError(
        caught instanceof ImageProcessingError
          ? { kind: 'process', fileName: caught.fileName }
          : { kind: 'upload' },
      );
    } finally {
      setIsUploading(false);
    }
  }

  function errorMessage(current: UploadError): string {
    switch (current.kind) {
      case 'type':
        return t('productFormImageErrorType');
      case 'tooLarge':
        return t('productFormImageErrorTooLarge', {
          name: shortFileName(current.fileName),
          maxMb: MAX_SOURCE_MB,
        });
      case 'tooMany':
        return t('productFormImageErrorTooMany', { max: current.max });
      case 'process':
        return t('productFormImageErrorProcess', { name: shortFileName(current.fileName) });
      case 'upload':
        return errorLabel;
    }
  }

  function handleRemove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleMove(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= value.length) {
      return;
    }
    const next = [...value];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((url, index) => (
            <li key={url} className="flex flex-col items-center gap-1">
              <Image
                src={url}
                alt=""
                width={48}
                height={48}
                className="size-12 shrink-0 rounded object-cover"
              />
              <div className="flex gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={moveUpLabel}
                  disabled={index === 0}
                  onClick={() => handleMove(index, -1)}
                >
                  <ChevronUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={moveDownLabel}
                  disabled={index === value.length - 1}
                  onClick={() => handleMove(index, 1)}
                >
                  <ChevronDown />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={removeLabel}
                  onClick={() => handleRemove(index)}
                >
                  <X />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={PRODUCT_IMAGE_ALLOWED_TYPES.join(',')}
        multiple
        className="hidden"
        onChange={(event) => void handleFilesChange(event)}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isUploading || isFull}
        onClick={() => inputRef.current?.click()}
        className="self-start"
      >
        {isUploading ? uploadingLabel : uploadLabel}
      </Button>

      <span className="text-xs text-muted-foreground">
        {t('productFormImageHint', {
          maxMb: MAX_SOURCE_MB,
          count: value.length,
          max: PRODUCT_VARIANT_MAX_IMAGES,
        })}
      </span>

      {error && (
        <span role="alert" className="text-xs wrap-break-word text-destructive">
          {errorMessage(error)}
        </span>
      )}
    </div>
  );
}
