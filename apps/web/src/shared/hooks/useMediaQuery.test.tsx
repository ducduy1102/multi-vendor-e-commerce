import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMediaQuery } from './useMediaQuery';

type Listener = () => void;

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const state = { matches: initial };
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return state.matches;
      },
      media: query,
      addEventListener: (_event: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_event: string, listener: Listener) => listeners.delete(listener),
    })),
  );
  return {
    listeners,
    set(next: boolean) {
      state.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('useMediaQuery', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('trả giá trị hiện tại của media query', () => {
    stubMatchMedia(true);

    const { result } = renderHook(() => useMediaQuery('(min-width: 80rem)'));

    expect(result.current).toBe(true);
  });

  it('cập nhật khi khổ màn hình đổi qua ngưỡng', () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 80rem)'));
    expect(result.current).toBe(false);

    act(() => media.set(true));
    expect(result.current).toBe(true);

    act(() => media.set(false));
    expect(result.current).toBe(false);
  });

  it('render trên server (và lúc hydrate đầu) luôn là false dù trình duyệt khớp query — tránh lệch hydrate', () => {
    stubMatchMedia(true);
    function Probe() {
      return <span>{String(useMediaQuery('(min-width: 80rem)'))}</span>;
    }

    expect(renderToString(<Probe />)).toContain('false');
  });

  it('hỏi đúng chuỗi query được truyền vào', () => {
    stubMatchMedia(false);

    renderHook(() => useMediaQuery('(min-width: 80rem)'));

    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 80rem)');
  });

  it('gỡ listener khi component unmount (không rò rỉ)', () => {
    const media = stubMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 80rem)'));
    expect(media.listeners.size).toBe(1);

    unmount();

    expect(media.listeners.size).toBe(0);
  });
});
