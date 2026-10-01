'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';

import { Badge } from '@/shared/components/ui/badge';

import type { Address } from '../types';

interface AddressRadioListProps {
  addresses: Address[];
  // null khi chưa chọn địa chỉ nào.
  selectedId: string | null;
  onSelect: (addressId: string) => void;
}

// Danh sách chọn địa chỉ giao hàng (radio, đánh dấu mặc định — Week7.md 3.3), dùng ở
// /checkout (3.4). Component THUẦN: nhận `addresses` đã tải sẵn qua prop, không tự gọi
// useAddresses() — loading/error/empty của phần dữ liệu là việc của nơi gọi (rules/frontend.md
// mục 10), ở đây chỉ xử lý trạng thái "0 địa chỉ" (luôn đúng bất kể ai fetch). Native
// <input type="radio"> (không thêm primitive RadioGroup của shadcn — chưa được duyệt).
export function AddressRadioList({ addresses, selectedId, onSelect }: AddressRadioListProps) {
  const t = useTranslations('checkout');
  const name = useId();

  if (addresses.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('addressListEmpty')}</p>;
  }

  return (
    <div role="radiogroup" aria-label={t('addressListLabel')} className="flex flex-col gap-2">
      {addresses.map((address) => (
        <label
          key={address.id}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
        >
          <input
            type="radio"
            name={name}
            value={address.id}
            checked={selectedId === address.id}
            onChange={() => onSelect(address.id)}
            className="mt-1"
          />
          <span className="flex flex-1 flex-col gap-0.5 text-sm">
            <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
              {address.recipientName} · {address.phone}
              {address.isDefault ? (
                <Badge variant="outline">{t('addressDefaultBadge')}</Badge>
              ) : null}
            </span>
            <span className="text-muted-foreground">
              {address.line1}, {address.ward}, {address.province}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}
