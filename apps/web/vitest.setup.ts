import '@testing-library/jest-dom/vitest';

// jsdom không có matchMedia — embla-carousel (thumbnail gallery) gọi lúc khởi
// tạo để đọc option theo breakpoint. Stub tối thiểu, luôn "không khớp".
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Cùng lý do: embla-carousel dùng IntersectionObserver/ResizeObserver (jsdom
// không có) để theo dõi slide — stub không làm gì, đủ để khởi tạo chạy được.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
if (typeof window !== 'undefined') {
  window.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
  window.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
}
