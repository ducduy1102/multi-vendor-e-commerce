import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ShopLogo } from './ShopLogo';

describe('ShopLogo', () => {
  it('có URL -> ảnh thuần trang trí (alt rỗng), không gửi referrer sang máy chủ ảnh lạ', () => {
    const { container } = render(<ShopLogo src="https://cdn.example.com/logo.png" />);

    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('không có logo -> biểu tượng thay thế, không có thẻ img', () => {
    const { container } = render(<ShopLogo src={null} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('ảnh tải lỗi -> chuyển sang biểu tượng thay thế (không để icon ảnh vỡ của trình duyệt)', () => {
    const { container } = render(<ShopLogo src="https://cdn.example.com/dead.png" />);

    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('đổi sang URL khác sau khi 1 URL lỗi -> thử tải lại URL mới bình thường', () => {
    const { container, rerender } = render(<ShopLogo src="https://cdn.example.com/dead.png" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    rerender(<ShopLogo src="https://cdn.example.com/new.png" />);

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/new.png',
    );
  });

  it('URL host lạ không làm component ném lỗi (khác next/image cần khai remotePatterns)', () => {
    expect(() => render(<ShopLogo src="https://unknown-host.example.org/a.png" />)).not.toThrow();
  });
});
