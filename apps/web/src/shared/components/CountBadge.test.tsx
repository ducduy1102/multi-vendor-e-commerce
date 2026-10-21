import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CountBadge } from './CountBadge';

describe('CountBadge', () => {
  it.each([null, undefined, 0, -3])('count=%s -> không hiện gì', (count) => {
    const { container } = render(<CountBadge count={count} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('hiện đúng số', () => {
    render(<CountBadge count={5} />);

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('đúng 99 vẫn hiện 99, từ 100 trở lên rút gọn 99+', () => {
    const { rerender } = render(<CountBadge count={99} />);
    expect(screen.getByText('99')).toBeInTheDocument();

    rerender(<CountBadge count={100} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('chỉ trang trí (aria-hidden) để trình đọc màn hình không đọc trùng số', () => {
    render(<CountBadge count={3} />);

    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true');
  });

  it('mặc định đè góc icon (absolute); className ghi đè được để dùng inline trong menu', () => {
    const { rerender } = render(<CountBadge count={3} />);
    expect(screen.getByText('3')).toHaveClass('absolute');

    rerender(<CountBadge count={3} className="static ml-auto" />);
    expect(screen.getByText('3')).toHaveClass('static', 'ml-auto');
    expect(screen.getByText('3')).not.toHaveClass('absolute');
  });
});
