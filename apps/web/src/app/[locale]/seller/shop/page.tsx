import { ShopDashboardContainer } from '@/modules/shop';

import { SellerShopAppealEntry } from './_components/SellerShopAppealEntry';

export default function SellerShopPage() {
  return (
    <div className="mx-auto w-full max-w-lg flex-1 px-4 py-16">
      {/* Mục kháng nghị do page ghép (module `shop` không import `appeal`) — hiện ngay dưới banner "shop bị khoá". */}
      <ShopDashboardContainer appealSlot={<SellerShopAppealEntry />} />
    </div>
  );
}
