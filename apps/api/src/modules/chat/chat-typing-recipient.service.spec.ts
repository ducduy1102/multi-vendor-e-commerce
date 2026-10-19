import { ShopStatus } from '@prisma/client';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { createFakeRealtimeEmitter } from '../../shared/testing/fake-realtime-emitter';
import type { ChatShopInfo } from './chat-directory';
import { ChatService } from './chat.service';

const CONVERSATION_ID = '8f14e45f-ceea-4672-9d6b-6f8e3a7c1d10';
const BUYER = 'buyer-1';
const OWNER = 'owner-1';
const SHOP_ID = 'c4ca4238-a0b9-4382-8dcc-509a6f75849b';
const T = new Date('2030-01-02T12:00:00.000Z');

const shopInfo = (overrides: Partial<ChatShopInfo> = {}): ChatShopInfo => ({
  id: SHOP_ID,
  ownerId: OWNER,
  status: ShopStatus.APPROVED,
  name: 'Shop Áo',
  logoUrl: null,
  ...overrides,
});

describe('ChatService.resolveTypingRecipient', () => {
  let service: ChatService;
  let findUnique: jest.Mock;
  let directory: {
    getShopForChat: jest.Mock;
    getShopsForChat: jest.Mock;
    getUserDisplay: jest.Mock;
  };

  const resolve = (userId: string, conversationId = CONVERSATION_ID) =>
    service.resolveTypingRecipient(userId, conversationId);

  beforeEach(() => {
    findUnique = jest
      .fn()
      .mockResolvedValue({ buyerId: BUYER, shopId: SHOP_ID, lastMessageAt: T });
    directory = {
      getShopForChat: jest.fn().mockResolvedValue(shopInfo()),
      getShopsForChat: jest.fn(),
      getUserDisplay: jest.fn(),
    };
    service = new ChatService(
      { conversation: { findUnique } } as unknown as PrismaService,
      directory,
      createFakeRealtimeEmitter(),
    );
  });

  it('người mua của hội thoại ⇒ người nhận là CHỦ SHOP', async () => {
    await expect(resolve(BUYER)).resolves.toBe(OWNER);
  });

  it('chủ shop của hội thoại ⇒ người nhận là NGƯỜI MUA', async () => {
    await expect(resolve(OWNER)).resolves.toBe(BUYER);
  });

  it.each([
    ['người lạ', 'stranger'],
    ['chủ một shop khác', 'owner-2'],
    ['người mua của hội thoại khác', 'buyer-2'],
    ['chuỗi rỗng', ''],
  ])('%s ⇒ null', async (_name, userId) => {
    await expect(resolve(userId)).resolves.toBeNull();
  });

  it('hội thoại không tồn tại ⇒ null, không tra danh bạ', async () => {
    findUnique.mockResolvedValue(null);

    await expect(resolve(BUYER)).resolves.toBeNull();

    expect(directory.getShopForChat).not.toHaveBeenCalled();
  });

  it('hội thoại CHƯA CÓ TIN ⇒ null ở cả hai phía (đối phương chưa hề thấy nó tồn tại), không tra danh bạ', async () => {
    findUnique.mockResolvedValue({
      buyerId: BUYER,
      shopId: SHOP_ID,
      lastMessageAt: null,
    });

    await expect(resolve(BUYER)).resolves.toBeNull();
    await expect(resolve(OWNER)).resolves.toBeNull();

    expect(directory.getShopForChat).not.toHaveBeenCalled();
  });

  it.each([
    ['SUSPENDED', ShopStatus.SUSPENDED],
    ['REJECTED', ShopStatus.REJECTED],
    ['PENDING', ShopStatus.PENDING],
  ])(
    'shop %s (hội thoại chỉ đọc) ⇒ null cho cả hai phía',
    async (_name, status) => {
      directory.getShopForChat.mockResolvedValue(shopInfo({ status }));

      await expect(resolve(BUYER)).resolves.toBeNull();
      await expect(resolve(OWNER)).resolves.toBeNull();
    },
  );

  it('shop không còn tồn tại trong danh bạ ⇒ null', async () => {
    directory.getShopForChat.mockResolvedValue(null);

    await expect(resolve(BUYER)).resolves.toBeNull();
  });

  it('chỉ đọc đúng 3 cột của hội thoại và tra shop theo shopId LẤY TỪ DB', async () => {
    await resolve(BUYER);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      select: { buyerId: true, shopId: true, lastMessageAt: true },
    });
    expect(directory.getShopForChat).toHaveBeenCalledWith(SHOP_ID);
  });

  it('người nhận là chủ shop HIỆN TẠI trong DB, không phải giá trị nào khác', async () => {
    directory.getShopForChat.mockResolvedValue(
      shopInfo({ ownerId: 'new-owner' }),
    );

    await expect(resolve(BUYER)).resolves.toBe('new-owner');
    await expect(resolve(OWNER)).resolves.toBeNull(); // chủ cũ không còn là thành viên
    await expect(resolve('new-owner')).resolves.toBe(BUYER);
  });

  it('lỗi DB được ném tiếp để gateway tự xử lý (không nuốt thành null)', async () => {
    findUnique.mockRejectedValue(new Error('db down'));

    await expect(resolve(BUYER)).rejects.toThrow('db down');
  });
});
