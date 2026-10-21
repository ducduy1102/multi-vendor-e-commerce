import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageListSkeleton } from './MessageListSkeleton';

describe('MessageListSkeleton', () => {
  it('aria-hidden, cột khai tường minh grid-cols-1 (chuỗi dài không làm cột rộng ra)', () => {
    const { container } = render(<MessageListSkeleton />);

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).toHaveClass('grid', 'grid-cols-1');
  });

  it('bong bóng xen kẽ hai phía và cùng trần max-w-[85%] với MessageBubble', () => {
    const { container } = render(<MessageListSkeleton />);

    const rows = Array.from(container.firstElementChild?.children ?? []);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const sides = rows.map((row) => (row.className.includes('justify-end') ? 'right' : 'left'));
    expect(new Set(sides)).toEqual(new Set(['left', 'right']));
    for (const row of rows) expect(row.firstElementChild?.className).toContain('max-w-[85%]');
  });

  it('khối xương tắt chuyển động khi giảm chuyển động', () => {
    const { container } = render(<MessageListSkeleton />);

    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThan(0);
    for (const bone of bones) expect(bone).toHaveClass('motion-reduce:animate-none');
  });
});
