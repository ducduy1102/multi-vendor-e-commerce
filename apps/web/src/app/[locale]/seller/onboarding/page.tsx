import { getTranslations } from 'next-intl/server';

import { BecomeSellerFormContainer } from '@/modules/shop';

export default async function SellerOnboardingPage() {
  const t = await getTranslations('shop');

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold">{t('becomeSellerTitle')}</h1>
        <BecomeSellerFormContainer />
      </div>
    </div>
  );
}
