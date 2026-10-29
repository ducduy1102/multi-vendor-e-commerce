'use client';

import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { ADMIN_USER_SEARCH_MAX_LENGTH } from '@ecommerce/types';

import { Link } from '@/i18n/navigation';
import { Input } from '@/shared/components/ui/input';
import { cn } from '@/shared/lib/utils';

import { ADMIN_USER_LINK_FOCUS_CLASS } from './admin-user-row.constants';

interface AdminUserSearchFormProps {
  // Từ khoá ĐANG ÁP DỤNG (từ URL). Nơi dùng đặt `key` theo giá trị này để ô nhập khởi tạo lại khi URL đổi từ bên ngoài (Back,
  // bấm "Xoá bộ lọc") — không cần effect đồng bộ.
  appliedQuery: string;
  // Gửi từ khoá đã cắt khoảng trắng ('' = bỏ tìm). Việc đổi URL nằm ở Container.
  onSearch: (query: string) => void;
  // Link bỏ từ khoá (giữ nguyên các bộ lọc khác); chỉ hiện nút xoá khi đang có từ khoá áp dụng.
  clearHref: string;
}

// Ô tìm theo email hoặc tên. Gửi bằng Enter (không tìm theo từng phím gõ: mỗi lần tìm là một truy vấn có phân trang và đổi URL).
// Độ dài giới hạn bằng hằng của BE; ký tự điều khiển không gõ được vào ô một dòng, và URL gõ tay sai dạng đã được
// parseAdminUsersPageQuery loại.
export function AdminUserSearchForm({
  appliedQuery,
  onSearch,
  clearHref,
}: AdminUserSearchFormProps) {
  const t = useTranslations('admin');
  const inputId = useId();
  const [value, setValue] = useState(appliedQuery);

  return (
    <form
      role="search"
      className="relative min-w-0 flex-1 sm:max-w-sm"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(value.trim());
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        {t('usersSearchLabel')}
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id={inputId}
        name="q"
        type="text"
        enterKeyHint="search"
        autoComplete="off"
        maxLength={ADMIN_USER_SEARCH_MAX_LENGTH}
        value={value}
        placeholder={t('usersSearchPlaceholder')}
        className="h-9 pr-8 pl-8"
        onChange={(event) => setValue(event.target.value)}
      />
      {appliedQuery ? (
        <Link
          href={clearHref}
          aria-label={t('usersSearchClear')}
          className={cn(
            'absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted',
            ADMIN_USER_LINK_FOCUS_CLASS,
          )}
        >
          <X aria-hidden="true" className="size-3.5" />
        </Link>
      ) : null}
    </form>
  );
}
