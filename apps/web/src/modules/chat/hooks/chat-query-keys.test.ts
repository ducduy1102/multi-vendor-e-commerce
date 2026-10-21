import { describe, expect, it } from 'vitest';

import type { ChatScope } from '../types';
import {
  chatScopeQueryKey,
  conversationsQueryKey,
  messagesQueryKey,
  otherReadMarkQueryKey,
  seededConversationQueryKey,
  unreadCountQueryKey,
} from './chat-query-keys';

const BUYER: ChatScope = { role: 'BUYER' };
const SHOP_A: ChatScope = { role: 'SHOP', shopId: 'shop-a' };
const SHOP_B: ChatScope = { role: 'SHOP', shopId: 'shop-b' };

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, index) => key[index] === part);

describe('chat query keys', () => {
  it('tiền tố phạm vi: người mua và từng shop tách bạch', () => {
    expect(chatScopeQueryKey(BUYER)).toEqual(['chat', 'buyer']);
    expect(chatScopeQueryKey(SHOP_A)).toEqual(['chat', 'shop', 'shop-a']);
  });

  it('mọi key của một phạm vi đều bắt đầu bằng tiền tố phạm vi đó (làm mới theo tiền tố kéo theo tất cả)', () => {
    for (const scope of [BUYER, SHOP_A]) {
      const prefix = chatScopeQueryKey(scope);

      expect(startsWith(conversationsQueryKey(scope), prefix)).toBe(true);
      expect(startsWith(unreadCountQueryKey(scope), prefix)).toBe(true);
      expect(startsWith(messagesQueryKey(scope, 'c1'), prefix)).toBe(true);
      expect(startsWith(seededConversationQueryKey(scope, 'c1'), prefix)).toBe(true);
    }
  });

  it('key của phạm vi này KHÔNG nằm dưới tiền tố của phạm vi khác (shop A ≠ shop B ≠ người mua)', () => {
    expect(startsWith(conversationsQueryKey(SHOP_A), chatScopeQueryKey(SHOP_B))).toBe(false);
    expect(startsWith(conversationsQueryKey(SHOP_A), chatScopeQueryKey(BUYER))).toBe(false);
    expect(startsWith(conversationsQueryKey(BUYER), chatScopeQueryKey(SHOP_A))).toBe(false);
  });

  it('key tin nhắn có id hội thoại; hai hội thoại khác nhau thì key khác nhau', () => {
    expect(messagesQueryKey(BUYER, 'c1')).not.toEqual(messagesQueryKey(BUYER, 'c2'));
    expect(messagesQueryKey(BUYER, 'c1')).toEqual(['chat', 'buyer', 'messages', 'c1']);
  });

  it('các loại key trong cùng phạm vi không trùng nhau', () => {
    const keys = [
      conversationsQueryKey(BUYER),
      unreadCountQueryKey(BUYER),
      messagesQueryKey(BUYER, 'c1'),
      seededConversationQueryKey(BUYER, 'c1'),
    ].map((key) => JSON.stringify(key));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mốc đã đọc của đối phương nằm NGOÀI mọi tiền tố phạm vi (làm mới theo phạm vi không xoá nó)', () => {
    const key = otherReadMarkQueryKey('c1');

    for (const scope of [BUYER, SHOP_A, SHOP_B]) {
      expect(startsWith(key, chatScopeQueryKey(scope))).toBe(false);
    }
    expect(key).toEqual(['chat', 'read', 'c1']);
  });
});
