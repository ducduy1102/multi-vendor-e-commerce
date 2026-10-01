import { Prisma } from '@prisma/client';
import type { TxClient } from '../../shared/prisma/tx-client';
import type { CreateOrdersInput } from './order.service';
import { OrderStatusService } from './order-status.service';
import { OrderService } from './order.service';

function baseInput(
  overrides: Partial<CreateOrdersInput> = {},
): CreateOrdersInput {
  return {
    checkoutGroupId: 'group-1',
    userId: 'user-1',
    voucherId: null,
    shipping: {
      recipientName: 'Nguyễn Văn A',
      recipientPhone: '0912345678',
      shippingAddressLine: '12 Nguyễn Huệ',
      shippingWard: 'Phường Bến Nghé',
      shippingProvince: 'Hồ Chí Minh',
    },
    orders: [
      {
        shopId: 'shop-1',
        shippingFee: 20_000,
        discountAmount: 0,
        totalAmount: 120_000,
        items: [
          {
            productVariantId: 'variant-1',
            productName: 'Áo thun',
            variantLabel: 'Đỏ / M',
            sku: 'SKU-1',
            imageUrl: 'https://x/img.jpg',
            quantity: 1,
            priceAtPurchase: 100_000,
          },
        ],
      },
    ],
    payment: {
      method: 'VNPAY',
      amount: 120_000,
      txnRef: 'TXNREF123',
      expiresAt: new Date('2026-09-27T04:00:00Z'),
    },
    ...overrides,
  };
}

describe('OrderService.createOrders', () => {
  let service: OrderService;
  let orderStatusService: { recordCreated: jest.Mock };
  let tx: {
    order: { create: jest.Mock };
    payment: { create: jest.Mock };
  };

  beforeEach(() => {
    let orderSeq = 0;
    tx = {
      order: {
        create: jest.fn(
          (args: {
            data: { shopId: string; totalAmount: number; status?: string };
          }) => ({
            id: `order-${++orderSeq}`,
            shopId: args.data.shopId,
            status: 'AWAITING_PAYMENT',
            totalAmount: new Prisma.Decimal(args.data.totalAmount),
          }),
        ),
      },
      payment: {
        create: jest.fn(() => ({ id: 'payment-1' })),
      },
    };
    orderStatusService = {
      recordCreated: jest.fn().mockResolvedValue(undefined),
    };
    service = new OrderService(
      orderStatusService as unknown as OrderStatusService,
    );
  });

  const call = (overrides: Partial<CreateOrdersInput> = {}) =>
    service.createOrders(tx as unknown as TxClient, baseInput(overrides));

  it('ghi mốc tạo đơn (fromStatus = null) cho mọi đơn vừa tạo, actor là buyer', async () => {
    await call();

    expect(orderStatusService.recordCreated).toHaveBeenCalledWith(
      tx,
      [{ id: 'order-1', status: 'AWAITING_PAYMENT' }],
      { type: 'BUYER', id: 'user-1' },
    );
  });

  it('tạo đúng 1 Order kèm snapshot địa chỉ và OrderItem, 1 Payment', async () => {
    const result = await call();

    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(tx.order.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        shopId: 'shop-1',
        checkoutGroupId: 'group-1',
        voucherId: null,
        totalAmount: 120_000,
        discountAmount: 0,
        shippingFee: 20_000,
        recipientName: 'Nguyễn Văn A',
        recipientPhone: '0912345678',
        shippingAddressLine: '12 Nguyễn Huệ',
        shippingWard: 'Phường Bến Nghé',
        shippingProvince: 'Hồ Chí Minh',
        items: {
          create: [
            {
              productVariantId: 'variant-1',
              productName: 'Áo thun',
              variantLabel: 'Đỏ / M',
              sku: 'SKU-1',
              imageUrl: 'https://x/img.jpg',
              quantity: 1,
              priceAtPurchase: 100_000,
            },
          ],
        },
      },
      select: { id: true, shopId: true, status: true, totalAmount: true },
    });

    expect(tx.payment.create).toHaveBeenCalledWith({
      data: {
        checkoutGroupId: 'group-1',
        method: 'VNPAY',
        amount: 120_000,
        txnRef: 'TXNREF123',
        expiresAt: new Date('2026-09-27T04:00:00Z'),
      },
      select: { id: true },
    });

    expect(result).toEqual({
      orders: [
        {
          id: 'order-1',
          shopId: 'shop-1',
          status: 'AWAITING_PAYMENT',
          totalAmount: '120000',
        },
      ],
      paymentId: 'payment-1',
    });
  });

  it('nhiều shop — tạo N Order nhưng ĐÚNG 1 Payment cho cả nhóm', async () => {
    const result = await call({
      orders: [
        baseInput().orders[0],
        {
          shopId: 'shop-2',
          shippingFee: 15_000,
          discountAmount: 5_000,
          totalAmount: 210_000,
          items: [
            {
              productVariantId: 'variant-2',
              productName: 'Quần jean',
              variantLabel: null,
              sku: 'SKU-2',
              imageUrl: null,
              quantity: 2,
              priceAtPurchase: 100_000,
            },
          ],
        },
      ],
    });

    expect(tx.order.create).toHaveBeenCalledTimes(2);
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
    expect(result.orders).toHaveLength(2);
    expect(result.orders.map((o) => o.shopId)).toEqual(['shop-1', 'shop-2']);
  });

  it('giữ voucherId (truy vết) trên mọi Order khi có voucher toàn sàn', async () => {
    await call({ voucherId: 'voucher-1' });

    const [args] = tx.order.create.mock.calls[0] as [
      { data: { voucherId: string | null } },
    ];
    expect(args.data.voucherId).toBe('voucher-1');
  });

  it('variantLabel/imageUrl null (không có thuộc tính/ảnh) vẫn ghi được', async () => {
    await call({
      orders: [
        {
          shopId: 'shop-1',
          shippingFee: 0,
          discountAmount: 0,
          totalAmount: 50_000,
          items: [
            {
              productVariantId: 'v1',
              productName: 'X',
              variantLabel: null,
              sku: 'S1',
              imageUrl: null,
              quantity: 1,
              priceAtPurchase: 50_000,
            },
          ],
        },
      ],
    });

    const [args] = tx.order.create.mock.calls[0] as [
      {
        data: {
          items: { create: Array<{ variantLabel: null; imageUrl: null }> };
        };
      },
    ];
    expect(args.data.items.create[0].variantLabel).toBeNull();
    expect(args.data.items.create[0].imageUrl).toBeNull();
  });
});
