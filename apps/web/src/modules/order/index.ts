// Barrel export cho module order — export những gì app/ cần (trang /orders,
// /orders/[id], /seller/orders). Không export sâu file nội bộ, và module này
// không được import modules/checkout hay modules/cart (shared/lib/
// module-boundaries.test.ts kiểm điều này) — mở rộng dần ở 3.2+ (container).
export {
  orderListQueryKey,
  orderQueryKey,
  sellerOrderListQueryKey,
  sellerOrderQueryKey,
} from './hooks/order-query-keys';
export { useCancelOrder } from './hooks/useCancelOrder';
export { useConfirmOrder } from './hooks/useConfirmOrder';
export { useConfirmReceived } from './hooks/useConfirmReceived';
export { useOrder } from './hooks/useOrder';
export { useOrders } from './hooks/useOrders';
export { usePackOrder } from './hooks/usePackOrder';
export { useRejectOrder } from './hooks/useRejectOrder';
export { useSellerOrder } from './hooks/useSellerOrder';
export { useSellerOrders } from './hooks/useSellerOrders';
export { useShipOrder } from './hooks/useShipOrder';
export * as orderService from './services/order.service';
export type {
  CancelOrderInput,
  OrderActorType,
  OrderDetail,
  OrderHistoryEntry,
  OrderListItem,
  OrderListQuery,
  OrderListResponse,
  OrderShop,
  OrderStatus,
  OrderTab,
  RejectOrderInput,
  SellerOrderDetail,
  SellerOrderListItem,
  SellerOrderListQuery,
  SellerOrderListResponse,
  SellerOrderTab,
  ShipOrderInput,
} from './types';
