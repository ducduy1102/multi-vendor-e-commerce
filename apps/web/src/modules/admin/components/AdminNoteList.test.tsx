import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { makeNote } from '../admin-note.fixtures';
import type { AdminNote } from '../types';
import { AdminNoteList } from './AdminNoteList';

function setup(
  overrides: Partial<React.ComponentProps<typeof AdminNoteList>> = {},
  locale: 'vi' | 'en' = 'vi',
) {
  const onRetry = vi.fn();
  const onLoadMore = vi.fn();
  const notes: AdminNote[] = overrides.notes ?? [
    makeNote({ id: 'a', content: 'ghi chú mới' }),
    makeNote({ id: 'b', content: 'ghi chú cũ' }),
  ];
  const utils = render(
    withIntl(
      <AdminNoteList
        isPending={false}
        isError={false}
        notes={notes}
        total={notes.length}
        hasNextPage={false}
        isFetchingNextPage={false}
        onRetry={onRetry}
        onLoadMore={onLoadMore}
        {...overrides}
      />,
      locale,
    ),
  );
  return { ...utils, onRetry, onLoadMore };
}

describe('AdminNoteList — các trạng thái', () => {
  it('đang tải: skeleton ẩn khỏi trình đọc màn hình, vùng bọc aria-busy kèm dòng chữ sr-only', () => {
    const { container } = setup({ isPending: true, notes: [] });

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Đang tải...')).toHaveClass('sr-only');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('lỗi và chưa có dữ liệu: báo lỗi và cho thử lại', async () => {
    const user = userEvent.setup();
    const { onRetry } = setup({ isError: true, notes: [] });

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được ghi chú.');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('lỗi NHƯNG đã có dữ liệu (lần làm mới ngầm lỗi): vẫn hiện danh sách, không thay bằng lỗi', () => {
    setup({ isError: true });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('ghi chú mới')).toBeInTheDocument();
  });

  it('rỗng: nói rõ chưa có ghi chú nào', () => {
    setup({ notes: [] });

    expect(screen.getByText('Chưa có ghi chú nào.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('có ghi chú: danh sách có nhãn, đúng thứ tự đã truyền (mới nhất trước)', () => {
    setup();

    const list = screen.getByRole('list', { name: 'Danh sách ghi chú' });
    const items = Array.from(list.querySelectorAll('li')).map((li) => li.textContent);
    expect(items[0]).toContain('ghi chú mới');
    expect(items[1]).toContain('ghi chú cũ');
  });
});

describe('AdminNoteList — tải thêm', () => {
  it('còn ghi chú cũ hơn: nút nêu CÒN BAO NHIÊU và gọi onLoadMore khi bấm', async () => {
    const user = userEvent.setup();
    const { onLoadMore } = setup({ total: 25, hasNextPage: true });

    await user.click(screen.getByRole('button', { name: 'Xem 23 ghi chú cũ hơn' }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('hết ghi chú (không còn trang kế): không có nút', () => {
    setup({ total: 2, hasNextPage: false });

    expect(screen.queryByRole('button', { name: /cũ hơn/ })).not.toBeInTheDocument();
  });

  it('đang tải trang kế: nút khoá và báo bận, không bấm trùng được', () => {
    setup({ total: 25, hasNextPage: true, isFetchingNextPage: true });

    const button = screen.getByRole('button', { name: /cũ hơn/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('số còn lại không bao giờ âm (total nhỏ hơn số đã tải do dữ liệu đổi giữa chừng)', () => {
    setup({ total: 1, hasNextPage: true });

    expect(screen.getByRole('button', { name: 'Xem 0 ghi chú cũ hơn' })).toBeInTheDocument();
  });

  it('bản tiếng Anh: không lẫn tiếng Việt', () => {
    setup({ total: 25, hasNextPage: true, notes: [makeNote({ authorName: null })] }, 'en');

    expect(screen.getByRole('list', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 24 older notes' })).toBeInTheDocument();
    expect(screen.queryByText(/Quản trị|ghi chú/i)).not.toBeInTheDocument();
  });
});
