import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { ForgotPasswordFormContainer } from '@/modules/auth';
import { AuthPageLayout } from '@/shared/components/AuthPageLayout';
import { ChotMark } from '@/shared/components/ChotMark';

export default async function ForgotPasswordPage() {
  // 2 await độc lập — Promise.all thay vì await nối tiếp (vercel-react-best-practices, async-parallel).
  const [t, tHeader] = await Promise.all([getTranslations('auth'), getTranslations('header')]);

  return (
    <AuthPageLayout>
      <Link href="/" className="mb-6 flex items-center justify-center gap-1.5">
        <ChotMark className="size-7 shrink-0" />
        <span className="font-semibold text-brand">{tHeader('siteName')}</span>
      </Link>
      <h1 className="mb-6 text-xl font-semibold">{t('forgotPasswordTitle')}</h1>
      <ForgotPasswordFormContainer />
    </AuthPageLayout>
  );
}
