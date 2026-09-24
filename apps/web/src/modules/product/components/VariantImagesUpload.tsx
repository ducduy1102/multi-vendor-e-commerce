'use client';

import Image from 'next/image';
import { useRef, useState, type ChangeEvent } from 'react';

import { Button } from '@/shared/components/ui/button';
import { useUploadSignature } from '../hooks/useUploadSignature';
import { uploadToCloudinary } from './uploadToCloudinary';

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
  const uploadSignature = useUploadSignature();
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Reset ngay để chọn lại đúng bộ file cũ (vd upload lỗi, thử lại) vẫn
    // bắn sự kiện change — input giữ nguyên value cũ thì browser coi là
    // không đổi, không gọi lại onChange.
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    setStatus('uploading');
    try {
      const uploadedUrls: string[] = [];
      // Ký + upload TUẦN TỰ từng file (không Promise.all) — mỗi file cần 1
      // chữ ký riêng (useUploadSignature không cache, đúng lý do đã ghi ở
      // VariantImageUpload cũ), tuần tự cũng đủ nhanh với số ảnh/variant
      // thực tế (vài ảnh), không cần phức tạp hoá bằng song song.
      for (const file of files) {
        const signature = await uploadSignature.mutateAsync();
        const url = await uploadToCloudinary(file, signature);
        uploadedUrls.push(url);
      }
      onChange([...value, ...uploadedUrls]);
      setStatus('idle');
    } catch {
      setStatus('error');
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
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={moveDownLabel}
                  disabled={index === value.length - 1}
                  onClick={() => handleMove(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={removeLabel}
                  onClick={() => handleRemove(index)}
                >
                  ×
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => void handleFilesChange(event)}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={status === 'uploading'}
        onClick={() => inputRef.current?.click()}
        className="self-start"
      >
        {status === 'uploading' ? uploadingLabel : uploadLabel}
      </Button>

      {status === 'error' && <span className="text-xs text-destructive">{errorLabel}</span>}
    </div>
  );
}
