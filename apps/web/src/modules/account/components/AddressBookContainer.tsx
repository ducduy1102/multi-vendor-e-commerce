'use client';

import { MAX_ADDRESSES_PER_USER } from '@ecommerce/types';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  AddressFormContainer,
  useAddresses,
  useDeleteAddress,
  useSetDefaultAddress,
  type Address,
} from '@/modules/checkout';
import { Button } from '@/shared/components/ui/button';

import { AddressBookItem } from './AddressBookItem';
import { AddressBookSkeleton } from './AddressBookSkeleton';
import { DeleteAddressDialog } from './DeleteAddressDialog';

// Chỉ một form (thêm HOẶC sửa một địa chỉ) mở tại một thời điểm: AddressForm dùng id cố định cho từng ô
// (`address-line1`...), hai form cùng lúc trong DOM sẽ trùng id và nhãn trỏ nhầm ô.
type OpenForm = { kind: 'create' } | { kind: 'edit'; id: string } | null;

// Sổ địa chỉ của /account/addresses (Week9.md 6.2). Dữ liệu và mọi thao tác ghi đi qua hook của
// `modules/checkout` (barrel) — module đó đã có CRUD địa chỉ, `account` chỉ ghép giao diện quản lý lên trên;
// tạo/sửa dùng chính AddressFormContainer của checkout (cùng luật validate, cùng dịch mã lỗi). Luật nghiệp
// vụ do BE giữ: tối đa MAX_ADDRESSES_PER_USER địa chỉ (409 ADDRESS_LIMIT_REACHED nếu vượt), địa chỉ đầu tiên
// tự mặc định, xoá địa chỉ mặc định thì địa chỉ thêm gần nhất lên thay — FE chỉ khoá nút cho khỏi bấm vô ích.
export function AddressBookContainer() {
  const t = useTranslations('account');
  const addressesQuery = useAddresses();
  const setDefaultAddress = useSetDefaultAddress();
  const deleteAddress = useDeleteAddress();
  const [openForm, setOpenForm] = useState<OpenForm>(null);
  const [deleteTarget, setDeleteTarget] = useState<Address | null>(null);

  if (addressesQuery.isPending) {
    return <AddressBookSkeleton />;
  }

  if (addressesQuery.isError) {
    return (
      <div className="flex max-w-2xl flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          {t('addressesLoadError')}
        </p>
        <Button type="button" variant="outline" onClick={() => void addressesQuery.refetch()}>
          {t('addressesRetry')}
        </Button>
      </div>
    );
  }

  const addresses = addressesQuery.data;
  const isLimitReached = addresses.length >= MAX_ADDRESSES_PER_USER;
  const isBusy = setDefaultAddress.isPending || deleteAddress.isPending;

  function handleSetDefault(address: Address) {
    setDefaultAddress.mutate(address.id, {
      onSuccess: () => toast.success(t('addressSetDefaultDone')),
      onError: () => toast.error(t('addressActionError')),
    });
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    deleteAddress.mutate(target.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        toast.success(t('addressDeleted'));
      },
      // Giữ hộp thoại mở để thử lại; toast báo lỗi.
      onError: () => toast.error(t('addressActionError')),
    });
  }

  return (
    <section aria-labelledby="account-addresses-title" className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id="account-addresses-title" className="text-base font-semibold text-foreground">
            {t('addressesTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('addressesCount', { count: addresses.length, max: MAX_ADDRESSES_PER_USER })}
          </p>
        </div>
        <Button
          type="button"
          disabled={isLimitReached || openForm !== null}
          onClick={() => setOpenForm({ kind: 'create' })}
        >
          <Plus aria-hidden="true" />
          {t('addressAdd')}
        </Button>
      </div>

      {isLimitReached ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('addressLimitReached', { max: MAX_ADDRESSES_PER_USER })}
        </p>
      ) : null}

      {openForm?.kind === 'create' ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">{t('addressAddTitle')}</h3>
          <AddressFormContainer
            onCreated={() => {
              setOpenForm(null);
              toast.success(t('addressSaved'));
            }}
            onCancel={() => setOpenForm(null)}
          />
        </div>
      ) : null}

      {addresses.length === 0 ? (
        openForm === null ? (
          <p className="text-sm text-muted-foreground">{t('addressesEmpty')}</p>
        ) : null
      ) : (
        <ul className="flex flex-col gap-3">
          {addresses.map((address) =>
            openForm?.kind === 'edit' && openForm.id === address.id ? (
              <li
                key={address.id}
                className="flex flex-col gap-3 rounded-lg border border-primary p-3"
              >
                <h3 className="text-sm font-semibold text-foreground">{t('addressEditTitle')}</h3>
                <AddressFormContainer
                  address={address}
                  onUpdated={() => {
                    setOpenForm(null);
                    toast.success(t('addressUpdated'));
                  }}
                  onCancel={() => setOpenForm(null)}
                />
              </li>
            ) : (
              <AddressBookItem
                key={address.id}
                address={address}
                isBusy={isBusy}
                onEdit={(target) => setOpenForm({ kind: 'edit', id: target.id })}
                onDelete={setDeleteTarget}
                onSetDefault={handleSetDefault}
              />
            ),
          )}
        </ul>
      )}

      <DeleteAddressDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          // Đang xoá thì không cho đóng bằng Esc/click ngoài — nút xác nhận đã khoá, hộp thoại phải ở lại
          // tới khi yêu cầu xong.
          if (!open && !deleteAddress.isPending) setDeleteTarget(null);
        }}
        recipientName={deleteTarget?.recipientName ?? ''}
        willPromoteAnother={Boolean(deleteTarget?.isDefault) && addresses.length > 1}
        isPending={deleteAddress.isPending}
        onConfirm={handleConfirmDelete}
      />
    </section>
  );
}
