import { blocksSellerFulfilment } from '@ecommerce/types';

import type { SellerOrderListItem } from './types';

// Bước giao nhận đang bị khoá vì người mua xin hủy.
export type BlockedFulfilmentStep = 'pack' | 'ship';

type FulfilmentOrder = Pick<
  SellerOrderListItem,
  'status' | 'canPack' | 'canShip' | 'refundRequest'
>;

// Khi người mua đang xin HỦY đơn (chờ shop, hoặc đã khiếu nại lên sàn), BE tắt cờ canPack/canShip: hàng đang bị
// xin hủy nên phải trả lời yêu cầu trước (Week9.md 1.3). Nút biến mất im lặng sẽ khiến shop tưởng đơn "kẹt"; UI
// thay vào đó hiện đúng nút của bước kế tiếp ở dạng khoá kèm lời giải thích. Hàm này chỉ chọn NÚT KHOÁ nào cần
// hiện — quyền thao tác luôn theo cờ của BE, không bao giờ bật nút nào ở đây: suy nhầm bước nhiều nhất chỉ làm
// hiện sai một nút khoá, không làm cho phép được điều BE cấm. Dùng chung `blocksSellerFulfilment` với BE nên hai
// phía không lệch luật "yêu cầu nào chặn".
//   - 'pack': đơn đã xác nhận, bước kế tiếp là đóng gói;
//   - 'ship': đơn đã đóng gói, bước kế tiếp là giao hàng;
//   - null: không bị chặn bởi yêu cầu hủy (hoặc BE vẫn bật cờ).
export function getBlockedFulfilmentStep(order: FulfilmentOrder): BlockedFulfilmentStep | null {
  const request = order.refundRequest;
  if (!request || !blocksSellerFulfilment(request.kind, request.status)) return null;
  if (order.status === 'CONFIRMED' && !order.canPack) return 'pack';
  if (order.status === 'PACKED' && !order.canShip) return 'ship';
  return null;
}
