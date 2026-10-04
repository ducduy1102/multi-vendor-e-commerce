import type { PlaceOrderInput } from './types';

// Dựng `shopNotes` của POST /checkout từ những gì người mua đã gõ (Week8.md 3B). Tách riêng khỏi
// CheckoutContainer (không unit test Container, rules/frontend.md mục 8) để luật gửi lên có test:
//  - chỉ gửi shop ĐANG có trong xem trước (giỏ vừa đổi thì lời nhắn của shop đã rời giỏ không đi
//    kèm; BE vẫn bỏ qua shopId lạ, đây chỉ là không gửi thừa);
//  - lời nhắn toàn khoảng trắng coi như không nhập; không gửi map rỗng (`undefined`);
//  - gửi nguyên văn phần người dùng gõ (BE tự trim) — không tự cắt/escape, hiển thị dạng text ở phía nhận.
export function buildShopNotes(
  orders: ReadonlyArray<{ shopId: string }>,
  notes: Readonly<Record<string, string>>,
): PlaceOrderInput['shopNotes'] {
  const entries = orders
    .map((order) => [order.shopId, notes[order.shopId] ?? ''] as const)
    .filter(([, note]) => note.trim() !== '');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
