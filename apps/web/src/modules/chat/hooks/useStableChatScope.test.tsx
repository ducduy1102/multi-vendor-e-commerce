import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SHOP_ID, uuid } from '../chat-test-data';
import type { ChatScope } from '../types';
import { useStableChatScope } from './useStableChatScope';

const SHOP: ChatScope = { role: 'SHOP', shopId: SHOP_ID };

describe('useStableChatScope', () => {
  it('cùng vai + shopId ⇒ cùng một object dù nơi gọi viết inline mỗi lần render', () => {
    const { result, rerender } = renderHook(() =>
      useStableChatScope({ role: 'SHOP', shopId: SHOP_ID }),
    );
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
    expect(result.current).toEqual(SHOP);
  });

  it('đổi shop ⇒ object mới; đổi sang người mua ⇒ không còn shopId', () => {
    const { result, rerender } = renderHook(({ scope }) => useStableChatScope(scope), {
      initialProps: { scope: SHOP as ChatScope },
    });
    const first = result.current;

    rerender({ scope: { role: 'SHOP', shopId: uuid(3003) } });
    expect(result.current).not.toBe(first);
    expect(result.current).toEqual({ role: 'SHOP', shopId: uuid(3003) });

    rerender({ scope: { role: 'BUYER' } });
    expect(result.current).toEqual({ role: 'BUYER' });
    expect(result.current).not.toHaveProperty('shopId');
  });
});
