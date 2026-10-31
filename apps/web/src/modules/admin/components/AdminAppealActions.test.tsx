import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AdminAppealActions } from './AdminAppealActions';

afterEach(() => {
  cleanup();
});

function setup(props: Partial<React.ComponentProps<typeof AdminAppealActions>> = {}) {
  const onAccept = vi.fn();
  const onReject = vi.fn();
  render(
    withIntl(
      <AdminAppealActions
        targetName="Shop A"
        isDisabled={false}
        onAccept={onAccept}
        onReject={onReject}
        {...props}
      />,
    ),
  );
  return { onAccept, onReject };
}

describe('AdminAppealActions', () => {
  it('hai nút, tên truy cập kèm tên shop để phân biệt trên trang có nhiều dòng giống nhau', () => {
    setup();

    expect(screen.getByRole('button', { name: 'Chấp nhận: Shop A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Từ chối: Shop A' })).toBeInTheDocument();
  });

  it('kháng nghị sản phẩm: tên truy cập kèm tên SẢN PHẨM (đối tượng), không phải tên shop', () => {
    setup({ targetName: 'Dao bấm tự động' });

    expect(screen.getByRole('button', { name: 'Chấp nhận: Dao bấm tự động' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Từ chối: Dao bấm tự động' })).toBeInTheDocument();
  });

  it('"Chấp nhận" đứng trên "Từ chối" (nút chính trước)', () => {
    setup();

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Chấp nhận', 'Từ chối']);
  });

  it('bấm gọi đúng callback, mỗi nút một callback', async () => {
    const user = userEvent.setup();
    const { onAccept, onReject } = setup();

    await user.click(screen.getByRole('button', { name: 'Chấp nhận: Shop A' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Từ chối: Shop A' }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('khoá cả hai nút khi một hành động đang chạy', async () => {
    const user = userEvent.setup();
    const { onAccept, onReject } = setup({ isDisabled: true });

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      await user.click(button);
    }
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('phân cấp nút: "Từ chối" viền + chữ đỏ cảnh báo (không accent cam), "Chấp nhận" là nút đặc không mang màu cảnh báo', () => {
    setup();

    const reject = screen.getByRole('button', { name: 'Từ chối: Shop A' });
    const accept = screen.getByRole('button', { name: 'Chấp nhận: Shop A' });
    expect(reject.className).toContain('text-destructive');
    expect(reject.className).toContain('border-destructive/30');
    // Nút "Chấp nhận" là nút chính (`bg-primary`) và KHÔNG mang kiểu cảnh báo của "Từ chối" (lớp nền của Button có sẵn
    // `aria-invalid:border-destructive`, nên kiểm đúng hai lớp kiểu cảnh báo chứ không kiểm chuỗi "destructive").
    expect(accept).toHaveClass('bg-primary');
    expect(accept).not.toHaveClass('text-destructive');
    expect(accept).not.toHaveClass('border-destructive/30');
    for (const button of [accept, reject]) {
      expect(button.className).not.toMatch(/accent|orange|amber/);
      expect(button).toHaveClass('min-h-9');
    }
  });
});
