import type { Prisma } from '@prisma/client';

// Client của 1 `prisma.$transaction(async (tx) => ...)` đang mở. Các service dùng
// chung trong transaction (InventoryService, VoucherUsageService, OrderService.createOrders)
// nhận `tx: TxClient` làm tham số đầu tiên và không tự mở $transaction lồng — người điều
// phối (CheckoutService/PaymentService) mở transaction duy nhất rồi truyền tx xuống.
export type TxClient = Prisma.TransactionClient;
