import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AVATAR_CLASS, CONVERSATION_ROW_CLASS } from './chat-layout.constants';
import { ConversationListSkeleton } from './ConversationListSkeleton';

// Skeleton chỉ trang trí: aria-hidden, tôn trọng prefers-reduced-motion, và khớp bố cục thật qua hằng số class dùng chung
// (rules/frontend.md mục 10) để không nhảy layout khi dữ liệu về.
describe('ConversationListSkeleton', () => {
  it('aria-hidden và mặc định 6 dòng; số dòng tuỳ chỉnh được', () => {
    const { container, rerender } = render(<ConversationListSkeleton />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('li')).toHaveLength(6);

    rerender(<ConversationListSkeleton count={2} />);
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('mỗi dòng dùng CÙNG class dòng với ConversationListItem (khớp bố cục thật)', () => {
    const { container } = render(<ConversationListSkeleton count={1} />);

    const row = container.querySelector('li') as HTMLElement;
    for (const token of CONVERSATION_ROW_CLASS.split(' ')) expect(row).toHaveClass(token);
    expect(row.firstElementChild?.className).toContain(AVATAR_CLASS.split(' ')[0]);
  });

  it('mọi khối xương đều tắt chuyển động khi người dùng chọn giảm chuyển động', () => {
    const { container } = render(<ConversationListSkeleton count={2} />);

    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThan(0);
    for (const bone of bones) expect(bone).toHaveClass('motion-reduce:animate-none');
  });
});
