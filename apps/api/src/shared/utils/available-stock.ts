// Số buyer có thể đặt của 1 variant = kho vật lý trừ số đang giữ chỗ cho đơn chưa thanh toán
// (Week7.md 1.3). Bất biến 0 <= reservedStock <= stock do CHECK ở DB bảo vệ nên kết quả
// luôn >= 0. Mọi API dành cho buyer trả field `stock` với nghĩa này để FE không phải đổi.
export function availableStock(variant: {
  stock: number;
  reservedStock: number;
}): number {
  return variant.stock - variant.reservedStock;
}
