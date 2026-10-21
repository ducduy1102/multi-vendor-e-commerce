import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useImageFallback } from './useImageFallback';

describe('useImageFallback', () => {
  it('có URL và chưa lỗi ⇒ hiện ảnh', () => {
    const { result } = renderHook(() => useImageFallback('https://cdn.example.org/a.png'));

    expect(result.current.isShown).toBe(true);
  });

  it('không có URL (null) ⇒ không hiện ảnh, nơi dùng vẽ khối thay thế', () => {
    const { result } = renderHook(() => useImageFallback(null));

    expect(result.current.isShown).toBe(false);
  });

  it('onError ⇒ ẩn ảnh vỡ', () => {
    const { result } = renderHook(() => useImageFallback('https://cdn.example.org/a.png'));

    act(() => result.current.onError());

    expect(result.current.isShown).toBe(false);
  });

  it('nhớ đúng URL đã lỗi: đổi sang URL khác thì thử tải lại bình thường', () => {
    const { result, rerender } = renderHook(({ src }) => useImageFallback(src), {
      initialProps: { src: 'https://cdn.example.org/a.png' as string | null },
    });
    act(() => result.current.onError());
    expect(result.current.isShown).toBe(false);

    rerender({ src: 'https://cdn.example.org/b.png' });

    expect(result.current.isShown).toBe(true);
  });

  it('ref callback phát hiện ảnh đã lỗi TRƯỚC khi gắn handler (complete && naturalWidth === 0)', () => {
    const { result } = renderHook(() => useImageFallback('https://cdn.example.org/a.png'));
    const brokenImage = {
      complete: true,
      naturalWidth: 0,
      currentSrc: 'https://cdn.example.org/a.png',
    };

    act(() => result.current.imgRef(brokenImage as HTMLImageElement));

    expect(result.current.isShown).toBe(false);
  });

  it('ref callback bỏ qua ảnh còn đang tải hoặc đã tải xong bình thường', () => {
    const { result } = renderHook(() => useImageFallback('https://cdn.example.org/a.png'));

    act(() => {
      result.current.imgRef({
        complete: false,
        naturalWidth: 0,
        currentSrc: '',
      } as HTMLImageElement);
      result.current.imgRef({
        complete: true,
        naturalWidth: 40,
        currentSrc: 'https://cdn.example.org/a.png',
      } as HTMLImageElement);
      result.current.imgRef(null);
    });

    expect(result.current.isShown).toBe(true);
  });
});
