import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ChatInbox } from './ChatInbox';
import { CHAT_INBOX_CLASS } from './chat-layout.constants';

function setup(hasSelection: boolean) {
  return render(
    withIntl(
      <ChatInbox hasSelection={hasSelection} list={<p>danh sách</p>} thread={<p>hội thoại</p>} />,
    ),
  );
}

describe('ChatInbox', () => {
  it('hai vùng có nhãn cho trình đọc màn hình, mỗi vùng đúng MỘT bản trong DOM', () => {
    setup(false);

    expect(screen.getByRole('region', { name: 'Danh sách cuộc trò chuyện' })).toHaveTextContent(
      'danh sách',
    );
    expect(screen.getByRole('region', { name: 'Cuộc trò chuyện' })).toHaveTextContent('hội thoại');
    expect(screen.getAllByText('danh sách')).toHaveLength(1);
    expect(screen.getAllByText('hội thoại')).toHaveLength(1);
  });

  it('chưa chọn: dưới md chỉ thấy danh sách, hội thoại ẩn; từ md luôn hiện cả hai cột', () => {
    setup(false);

    const list = screen.getByRole('region', { name: 'Danh sách cuộc trò chuyện' });
    const thread = screen.getByRole('region', { name: 'Cuộc trò chuyện' });
    expect(list).toHaveClass('flex', 'md:flex');
    expect(list).not.toHaveClass('hidden');
    expect(thread).toHaveClass('hidden', 'md:flex');
  });

  it('đã chọn: dưới md chỉ thấy hội thoại (danh sách ẩn); từ md vẫn hai cột', () => {
    setup(true);

    const list = screen.getByRole('region', { name: 'Danh sách cuộc trò chuyện' });
    const thread = screen.getByRole('region', { name: 'Cuộc trò chuyện' });
    expect(list).toHaveClass('hidden', 'md:flex');
    expect(thread).toHaveClass('flex', 'md:flex');
    expect(thread).not.toHaveClass('hidden');
  });

  it('cột khai tường minh minmax(0,…) và mỗi vùng min-w-0: chuỗi dài không làm cột/trang rộng ra', () => {
    const { container } = setup(false);

    expect(CHAT_INBOX_CLASS).toContain('grid-cols-1');
    expect(CHAT_INBOX_CLASS).toContain('md:grid-cols-[18rem_minmax(0,1fr)]');
    expect(CHAT_INBOX_CLASS).toContain('lg:grid-cols-[22rem_minmax(0,1fr)]');
    for (const section of container.querySelectorAll('section')) {
      expect(section).toHaveClass('min-w-0', 'min-h-0');
    }
  });
});
