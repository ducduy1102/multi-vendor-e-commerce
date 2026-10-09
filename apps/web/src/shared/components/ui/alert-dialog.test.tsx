import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';

function renderDialog(props: { className?: string; size?: 'default' | 'sm' } = {}) {
  return render(
    <AlertDialog open>
      <AlertDialogContent {...props}>
        <AlertDialogHeader>
          <AlertDialogTitle>Tiêu đề</AlertDialogTitle>
          <AlertDialogDescription>Mô tả</AlertDialogDescription>
        </AlertDialogHeader>
      </AlertDialogContent>
    </AlertDialog>,
  );
}

// jsdom không có layout nên không đo được độ rộng; các test này giữ chỗ sửa tay ở primitive để không ai vô tình
// bỏ đi (hoặc để `shadcn add alert-dialog` ghi đè mất mà không ai hay). Đã đo bằng trình duyệt thật: thiếu
// `grid-cols-1`, nội dung hộp thoại rộng ~4257-4385px ở 390px khi nhập 500 ký tự liền vào ô nhập.
describe('AlertDialogContent', () => {
  it('khai cột lưới tường minh (grid-cols-1): cột ngầm định `auto` lấy min-content của ô nhập chứa chuỗi dài', () => {
    renderDialog();

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveClass('grid', 'grid-cols-1');
  });

  it('mọi cỡ (default và sm) đều có lớp đó — không biến thể nào quay lại cột `auto`', () => {
    const { unmount } = renderDialog({ size: 'default' });
    expect(screen.getByRole('alertdialog')).toHaveClass('grid-cols-1');
    unmount();

    renderDialog({ size: 'sm' });
    expect(screen.getByRole('alertdialog')).toHaveClass('grid-cols-1');
  });

  it('nơi dùng vẫn ghi đè được bằng className (tailwind-merge) khi thật sự cần bố cục khác', () => {
    renderDialog({ className: 'grid-cols-2' });

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveClass('grid-cols-2');
    expect(dialog).not.toHaveClass('grid-cols-1');
  });

  it('không làm mất các lớp định vị/bo góc của bản gốc (fixed, giữa màn hình, bo tròn)', () => {
    renderDialog();

    expect(screen.getByRole('alertdialog')).toHaveClass('fixed', 'rounded-xl', 'gap-4', 'w-full');
  });
});
