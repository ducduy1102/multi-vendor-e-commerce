import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { PublicShop } from '../types';
import { ShopPublicHeader } from './ShopPublicHeader';

const shop: PublicShop = {
  id: 'shop-1',
  name: 'Cửa hàng Hoa Mai',
  slug: 'cua-hang-hoa-mai',
  logoUrl: 'https://res.cloudinary.com/demo/logo.png',
  bannerUrl: 'https://res.cloudinary.com/demo/banner.png',
  description: 'Chuyên đồ gia dụng.\nGiao hàng toàn quốc.',
  createdAt: '2026-10-15T08:00:00.000Z',
  productCount: 12,
  avgRating: 4.3,
  reviewCount: 25,
};

function renderHeader(overrides: Partial<PublicShop> = {}) {
  return render(withIntl(<ShopPublicHeader shop={{ ...shop, ...overrides }} />));
}

function images(container: HTMLElement) {
  return Array.from(container.querySelectorAll('img'));
}

describe('ShopPublicHeader', () => {
  it('hiện tên (h1), số sản phẩm, tháng/năm tham gia và mô tả', () => {
    renderHeader();

    expect(screen.getByRole('heading', { level: 1, name: 'Cửa hàng Hoa Mai' })).toBeInTheDocument();
    expect(screen.getByText('12 sản phẩm')).toBeInTheDocument();
    expect(screen.getByText(/Tham gia tháng 10 năm 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Chuyên đồ gia dụng\./)).toBeInTheDocument();
  });

  it('ngày tham gia tính theo UTC: 23:30 UTC ngày cuối tháng vẫn là tháng đó (Server và client cùng chuỗi)', () => {
    renderHeader({ createdAt: '2026-10-31T23:30:00.000Z' });

    expect(screen.getByText(/Tham gia tháng 10 năm 2026/)).toBeInTheDocument();
  });

  it('ngày tham gia tính theo UTC: 00:30 UTC ngày đầu tháng vẫn là tháng đó (đối xứng cho máy múi giờ âm)', () => {
    renderHeader({ createdAt: '2026-11-01T00:30:00.000Z' });

    expect(screen.getByText(/Tham gia tháng 11 năm 2026/)).toBeInTheDocument();
  });

  it('có đánh giá: điểm số + sao + số lượt (nhãn sao đọc "4,3 trên 5 sao")', () => {
    renderHeader();

    expect(screen.getByText('4,3')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4,3 trên 5 sao' })).toBeInTheDocument();
    expect(screen.getByText('25 đánh giá')).toBeInTheDocument();
  });

  it('chưa có đánh giá: chữ "Chưa có đánh giá", KHÔNG vẽ sao', () => {
    renderHeader({ avgRating: 0, reviewCount: 0 });

    expect(screen.getByText('Chưa có đánh giá')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shop chưa có sản phẩm: "0 sản phẩm"', () => {
    renderHeader({ productCount: 0 });

    expect(screen.getByText('0 sản phẩm')).toBeInTheDocument();
  });

  describe('logo và banner (URL do chủ shop tự nhập)', () => {
    it('https hợp lệ: <img> trang trí, không gửi referrer', () => {
      const { container } = renderHeader();

      const found = images(container);
      expect(found).toHaveLength(2);
      for (const img of found) {
        expect(img).toHaveAttribute('alt', '');
        expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
      }
      expect(found.map((img) => img.getAttribute('src'))).toEqual([
        'https://res.cloudinary.com/demo/banner.png',
        'https://res.cloudinary.com/demo/logo.png',
      ]);
    });

    it('không có logo/banner: khối thay thế, không có <img>', () => {
      const { container } = renderHeader({ logoUrl: null, bannerUrl: null });

      expect(images(container)).toHaveLength(0);
    });

    it.each([
      ['javascript:', 'javascript:alert(1)'],
      ['data:', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
      ['http (không phải https)', 'http://cdn.example.org/a.png'],
      ['không phải URL', 'khong phai url'],
    ])(
      'URL %s bị loại ngay lúc render (dữ liệu cũ trong DB có thể không còn qua schema)',
      (_l, bad) => {
        const { container } = renderHeader({ logoUrl: bad, bannerUrl: bad });

        expect(images(container)).toHaveLength(0);
      },
    );

    it('ảnh đã lỗi TRƯỚC khi hydrate (sự kiện error bị bỏ lỡ): vẫn thay bằng khối thay thế', () => {
      // Dựng đúng trạng thái trình duyệt báo cho ảnh SSR tải hỏng xong trước khi React gắn handler:
      // complete = true, naturalWidth = 0, currentSrc có giá trị. Không có `error` nào được phát ra ở đây.
      const proto = HTMLImageElement.prototype;
      const originals = {
        complete: Object.getOwnPropertyDescriptor(proto, 'complete'),
        naturalWidth: Object.getOwnPropertyDescriptor(proto, 'naturalWidth'),
        currentSrc: Object.getOwnPropertyDescriptor(proto, 'currentSrc'),
      };
      Object.defineProperty(proto, 'complete', { configurable: true, get: () => true });
      Object.defineProperty(proto, 'naturalWidth', { configurable: true, get: () => 0 });
      Object.defineProperty(proto, 'currentSrc', {
        configurable: true,
        get: () => 'https://res.cloudinary.com/demo/broken.png',
      });
      try {
        const { container } = renderHeader();

        expect(images(container)).toHaveLength(0);
      } finally {
        for (const [key, descriptor] of Object.entries(originals)) {
          if (descriptor) Object.defineProperty(proto, key, descriptor);
          else delete (proto as unknown as Record<string, unknown>)[key];
        }
      }
    });

    it('ảnh còn đang tải (complete = false, naturalWidth = 0): KHÔNG bị coi là lỗi', () => {
      const proto = HTMLImageElement.prototype;
      const originalComplete = Object.getOwnPropertyDescriptor(proto, 'complete');
      Object.defineProperty(proto, 'complete', { configurable: true, get: () => false });
      try {
        const { container } = renderHeader();

        expect(images(container)).toHaveLength(2);
      } finally {
        if (originalComplete) Object.defineProperty(proto, 'complete', originalComplete);
        else delete (proto as unknown as Record<string, unknown>).complete;
      }
    });

    it('ảnh tải lỗi: thay bằng khối thay thế, không để icon ảnh vỡ', () => {
      const { container } = renderHeader();
      const [banner, logo] = images(container);

      fireEvent.error(logo);
      expect(images(container)).toHaveLength(1);

      fireEvent.error(banner);
      expect(images(container)).toHaveLength(0);
    });
  });

  describe('chỗ nút "Chat với shop" (chatSlot do page.tsx ghép vào)', () => {
    it('có chatSlot: hiện đúng nội dung được truyền vào', () => {
      render(
        withIntl(
          <ShopPublicHeader
            shop={shop}
            chatSlot={<button type="button">Nút chat do page ghép</button>}
          />,
        ),
      );

      expect(screen.getByRole('button', { name: 'Nút chat do page ghép' })).toBeInTheDocument();
    });

    it('không có chatSlot: không dựng nút nào và không còn dòng "sắp có" (không link tới trang chưa có)', () => {
      renderHeader();

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText(/sẽ sớm có/)).not.toBeInTheDocument();
      expect(screen.queryByText('Chat với shop')).not.toBeInTheDocument();
    });
  });

  describe('chữ dài do chủ shop nhập', () => {
    it('mô tả 2000 ký tự liền: break-words trong cột khai tường minh (không có `grid` trần)', () => {
      const { container } = renderHeader({ description: 'D'.repeat(2000) });

      const description = screen.getByText(new RegExp('D{2000}'));
      expect(description).toHaveClass('break-words');
      // Hàng tên/chat là lưới có cột tường minh: 1 cột ở mobile, [minmax(0,1fr) auto] ở lg.
      const grid = container.querySelector('.grid') as HTMLElement;
      expect(grid).toHaveClass('grid-cols-1');
      expect(grid.className).toContain('lg:grid-cols-[minmax(0,1fr)_auto]');
    });

    it('tên 100 ký tự liền: break-words và cột chữ co được (min-w-0)', () => {
      renderHeader({ name: 'N'.repeat(100) });

      const name = screen.getByRole('heading', { level: 1 });
      expect(name).toHaveClass('break-words');
      expect(name.parentElement).toHaveClass('min-w-0');
    });

    it('xuống dòng trong mô tả được giữ (whitespace-pre-line)', () => {
      renderHeader();

      expect(screen.getByText(/Chuyên đồ gia dụng\./)).toHaveClass('whitespace-pre-line');
    });
  });

  it('không có mô tả: không vẽ đoạn mô tả trống', () => {
    const { container } = renderHeader({ description: null });

    expect(container.querySelectorAll('header > p')).toHaveLength(0);
  });
});
