'use client';

import Image from 'next/image';
import { useRef, useState, type ChangeEvent } from 'react';

import { Button } from '@/shared/components/ui/button';
import { useUploadSignature } from '../hooks/useUploadSignature';
import { uploadToCloudinary } from './uploadToCloudinary';

interface VariantImageUploadProps {
  value?: string;
  onChange: (url: string | undefined) => void;
  uploadLabel: string;
  changeLabel: string;
  uploadingLabel: string;
  removeLabel: string;
  errorLabel: string;
}

// Trạng thái uploading/lỗi giữ RIÊNG cho từng instance của component (mỗi
// variant 1 component) — nhiều variant upload đồng thời không ảnh hưởng lẫn
// nhau, đúng yêu cầu Week4.md Bước 3.8. Lấy chữ ký qua useUploadSignature
// (useMutation, không cache — mỗi lần bấm chọn ảnh cần 1 signature mới) rồi
// tự upload thẳng lên Cloudinary (uploadToCloudinary.ts), không qua BE.
export function VariantImageUpload({
  value,
  onChange,
  uploadLabel,
  changeLabel,
  uploadingLabel,
  removeLabel,
  errorLabel,
}: VariantImageUploadProps) {
  const uploadSignature = useUploadSignature();
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset ngay để chọn lại đúng file cũ (vd upload lỗi, thử lại) vẫn bắn
    // sự kiện change — input giữ nguyên value cũ thì browser coi là không
    // đổi, không gọi lại onChange.
    event.target.value = '';
    if (!file) {
      return;
    }

    setStatus('uploading');
    try {
      const signature = await uploadSignature.mutateAsync();
      const url = await uploadToCloudinary(file, signature);
      onChange(url);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="flex items-center gap-2">
      {value ? (
        <Image
          src={value}
          alt=""
          width={40}
          height={40}
          className="size-10 shrink-0 rounded object-cover"
        />
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleFileChange(event)}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={status === 'uploading'}
        onClick={() => inputRef.current?.click()}
      >
        {status === 'uploading' ? uploadingLabel : value ? changeLabel : uploadLabel}
      </Button>

      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={removeLabel}
          onClick={() => onChange(undefined)}
        >
          ×
        </Button>
      )}

      {status === 'error' && <span className="text-xs text-destructive">{errorLabel}</span>}
    </div>
  );
}
