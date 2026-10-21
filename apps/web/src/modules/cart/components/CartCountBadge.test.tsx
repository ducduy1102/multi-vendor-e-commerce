import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CartCountBadge } from './CartCountBadge';

describe('CartCountBadge', () => {
  it.each([null, 0])('count=%s -> không hiện gì', (count) => {
    const { container } = render(<CartCountBadge count={count} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('hiện đúng số item', () => {
    render(<CartCountBadge count={5} />);

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('đúng 99 vẫn hiện 99, từ 100 trở lên rút gọn 99+', () => {
    const { rerender } = render(<CartCountBadge count={99} />);
    expect(screen.getByText('99')).toBeInTheDocument();

    rerender(<CartCountBadge count={100} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('chỉ trang trí (aria-hidden) để trình đọc màn hình không đọc trùng số', () => {
    render(<CartCountBadge count={3} />);

    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('CartCountBadge — vỏ mỏng của CountBadge dùng chung', () => {
  it('chuyển className của nơi dùng xuống huy hiệu (đặt lại vị trí được)', () => {
    render(<CartCountBadge count={4} className="static ml-auto" />);

    expect(screen.getByText('4')).toHaveClass('static', 'ml-auto');
  });

  it('mặc định đè góc icon (absolute) như trước khi trích ra shared', () => {
    render(<CartCountBadge count={4} />);

    expect(screen.getByText('4')).toHaveClass('absolute');
  });
});
