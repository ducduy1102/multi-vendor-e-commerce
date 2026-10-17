'use client';

import { useTranslations } from 'next-intl';

import type { Address } from '@/modules/checkout';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';

interface AddressBookItemProps {
  address: Address;
  // Một thao tác ghi đang chạy (đặt mặc định/xoá) ⇒ khoá mọi nút của danh sách, tránh bấm chồng.
  isBusy: boolean;
  onEdit: (address: Address) => void;
  onDelete: (address: Address) => void;
  onSetDefault: (address: Address) => void;
}

// Một thẻ địa chỉ trong sổ địa chỉ — thuần trình bày, không biết gì về mutation. Tên/địa chỉ do người dùng
// nhập (dòng 200 ký tự có thể không có dấu cách) nên cột chữ khai `min-w-0 flex-1 break-words`, nằm trong
// flex-col ở mobile (cột chữ chiếm đúng bề rộng khung) để không làm trang tràn ngang (rules/frontend.md
// mục 5). Nút nào cũng có `aria-label` kèm tên người nhận: danh sách có nhiều nút "Sửa"/"Xoá" y hệt nhau.
export function AddressBookItem({
  address,
  isBusy,
  onEdit,
  onDelete,
  onSetDefault,
}: AddressBookItemProps) {
  const t = useTranslations('account');
  const tCheckout = useTranslations('checkout');
  const name = address.recipientName;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm break-words">
        <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
          {/* min-w-0: span là flex item của hàng `flex-wrap` — mặc định `min-width: auto` bằng đúng độ rộng
              chuỗi không dấu cách (tên tối đa 100 ký tự), `break-words` không hạ được min-content nên không
              có min-w-0 thì cả trang tràn ngang (đã đo bằng Playwright ở 390px: 1370px). */}
          <span className="min-w-0">
            {address.recipientName} · {address.phone}
          </span>
          {address.isDefault ? (
            <Badge variant="outline">{tCheckout('addressDefaultBadge')}</Badge>
          ) : null}
        </p>
        <p className="text-muted-foreground">
          {address.line1}, {address.ward}, {address.province}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
        {address.isDefault ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isBusy}
            aria-label={t('addressSetDefaultAria', { name })}
            onClick={() => onSetDefault(address)}
          >
            {t('addressSetDefault')}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy}
          aria-label={t('addressEditAria', { name })}
          onClick={() => onEdit(address)}
        >
          {t('addressEdit')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-destructive"
          disabled={isBusy}
          aria-label={t('addressDeleteAria', { name })}
          onClick={() => onDelete(address)}
        >
          {t('addressDelete')}
        </Button>
      </div>
    </li>
  );
}
