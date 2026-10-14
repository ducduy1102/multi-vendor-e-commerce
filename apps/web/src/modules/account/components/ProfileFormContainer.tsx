'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useAuthStore } from '@/modules/auth';
import { Alert } from '@/shared/components/ui/alert';

import { useUpdateProfile } from '../hooks/useUpdateProfile';
import type { ProfileFormInput } from '../types';
import { AccountFormSkeleton } from './AccountFormSkeleton';
import { ProfileForm } from './ProfileForm';
import { SessionRequiredNotice } from './SessionRequiredNotice';

// Nối ProfileForm (UI + validate) với PATCH /auth/me. User lấy từ `useAuthStore` (nguồn duy nhất cho user
// hiện tại — không refetch bằng React Query); `isHydrating` quyết định hiện skeleton hay thông báo "cần
// đăng nhập", vì `user === null` tự nó không phân biệt "chưa kịp hỏi BE" với "chắc chắn chưa đăng nhập"
// (xem auth.store.ts). Lưu xong, `useUpdateProfile` ghi user mới vào store nên tên ở Header đổi ngay.
export function ProfileFormContainer() {
  const t = useTranslations('account');
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const updateProfile = useUpdateProfile();
  const [error, setError] = useState<string | null>(null);

  if (isHydrating) {
    return <AccountFormSkeleton fieldCount={3} />;
  }
  if (!user) {
    return <SessionRequiredNotice next="/account" />;
  }

  async function handleSubmit(values: ProfileFormInput) {
    setError(null);
    try {
      await updateProfile.mutateAsync(values);
      toast.success(t('profileSaved'));
    } catch {
      // Không in `err.message` của BE (có thể là chuỗi tiếng Anh/khoá validate chưa dịch): tên và ngôn ngữ
      // đã được kiểm bằng đúng schema của BE ở form nên lỗi còn lại là mạng/5xx — một câu chung là đủ.
      setError(t('profileSaveError'));
    }
  }

  return (
    <section aria-labelledby="account-profile-title" className="flex max-w-lg flex-col gap-4">
      <h2 id="account-profile-title" className="text-base font-semibold text-foreground">
        {t('profileTitle')}
      </h2>
      {error && <Alert variant="destructive">{error}</Alert>}
      <ProfileForm
        // Tài khoản khác đăng nhập vào cùng tab ⇒ form mới, không giữ giá trị người trước.
        key={user.id}
        email={user.email}
        isEmailVerified={user.emailVerifiedAt !== null}
        initialValues={{ name: user.name, locale: user.locale }}
        onSubmit={handleSubmit}
        isSubmitting={updateProfile.isPending}
      />
    </section>
  );
}
