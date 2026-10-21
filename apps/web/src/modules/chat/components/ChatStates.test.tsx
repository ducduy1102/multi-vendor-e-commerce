import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ChatEmptyState, ChatErrorState } from './ChatStates';

describe('ChatEmptyState', () => {
  it('hiện tiêu đề và gợi ý', () => {
    render(<ChatEmptyState title="Chưa có cuộc trò chuyện" hint="Bấm Chat với shop để bắt đầu" />);

    expect(screen.getByText('Chưa có cuộc trò chuyện')).toBeInTheDocument();
    expect(screen.getByText('Bấm Chat với shop để bắt đầu')).toBeInTheDocument();
  });

  it('không có gợi ý thì không dựng đoạn gợi ý rỗng', () => {
    const { container } = render(<ChatEmptyState title="Chọn một cuộc trò chuyện" />);

    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('biểu tượng trang trí (aria-hidden) và chữ dài xuống dòng được (break-words)', () => {
    const { container } = render(<ChatEmptyState title={'x'.repeat(300)} hint="gợi ý" />);

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('x'.repeat(300))).toHaveClass('break-words');
  });
});

describe('ChatErrorState', () => {
  it('hiện ĐÚNG câu đã dịch được truyền vào (role=alert) và nút "Thử lại" gọi onRetry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(withIntl(<ChatErrorState message="Không tải được tin nhắn." onRetry={onRetry} />));

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được tin nhắn.');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('bản tiếng Anh dùng nhãn tiếng Anh cho nút', () => {
    render(withIntl(<ChatErrorState message="Could not load" onRetry={vi.fn()} />, 'en'));

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
