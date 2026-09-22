import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { BecomeSellerFormContainer } from '@/modules/shop';
import { ChotMark } from '@/shared/components/ChotMark';

export default async function SellerOnboardingPage() {
  // 2 await độc lập — Promise.all thay vì await nối tiếp
  // (vercel-react-best-practices, async-parallel).
  const [t, tHeader] = await Promise.all([getTranslations('shop'), getTranslations('header')]);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-1.5">
          <ChotMark className="size-7 shrink-0" />
          <span className="font-semibold text-brand">{tHeader('siteName')}</span>
        </Link>
        <h1 className="mb-6 text-xl font-semibold">{t('becomeSellerTitle')}</h1>
        <BecomeSellerFormContainer />
      </div>
    </div>
  );
}
