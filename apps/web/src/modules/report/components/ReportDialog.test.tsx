import { REPORT_NOTE_MAX_LENGTH, REPORT_REASON_CODES_BY_TARGET } from '@ecommerce/types';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { ReportTargetType } from '../types';
import { ReportDialog } from './ReportDialog';

afterEach(() => {
  cleanup();
});

const TARGET_ID = '11111111-1111-4111-8111-111111111111';

function setup(
  props: Partial<React.ComponentProps<typeof ReportDialog>> = {},
  locale: 'vi' | 'en' = 'vi',
) {
  const onSubmit = vi.fn().mockResolvedValue(true);
  const onOpenChange = vi.fn();
  render(
    withIntl(
      <ReportDialog
        open
        onOpenChange={onOpenChange}
        targetType="REVIEW"
        targetId={TARGET_ID}
        isPending={false}
        error={null}
        onSubmit={onSubmit}
        {...props}
      />,
      locale,
    ),
  );
  return { onSubmit: (props.onSubmit as typeof onSubmit | undefined) ?? onSubmit, onOpenChange };
}

const submitButton = () => screen.getByRole('button', { name: 'Gửi báo cáo' });
const noteBox = () => screen.getByLabelText(/^Mô tả/) as HTMLTextAreaElement;

describe('ReportDialog — lý do theo loại đối tượng', () => {
  it.each([
    ['REVIEW', 'Báo cáo đánh giá này'],
    ['CONVERSATION', 'Báo cáo cuộc trò chuyện này'],
    ['SHOP', 'Báo cáo shop này'],
    ['PRODUCT', 'Báo cáo sản phẩm này'],
  ] as [ReportTargetType, string][])(
    '%s: tiêu đề riêng và đúng tập lý do mà BE chấp nhận cho loại này (không thừa, không thiếu)',
    (targetType, title) => {
      setup({ targetType });

      expect(screen.getByRole('alertdialog', { name: title })).toBeInTheDocument();
      expect(screen.getAllByRole('radio')).toHaveLength(
        REPORT_REASON_CODES_BY_TARGET[targetType].length,
      );
    },
  );

  it('đánh giá có "Đánh giá giả mạo" nhưng shop thì không; shop có "Hàng giả, hàng nhái" nhưng đánh giá thì không', () => {
    setup({ targetType: 'REVIEW' });
    expect(screen.getByRole('radio', { name: 'Đánh giá giả mạo' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Hàng giả, hàng nhái' })).not.toBeInTheDocument();

    cleanup();
    setup({ targetType: 'SHOP' });
    expect(screen.getByRole('radio', { name: 'Hàng giả, hàng nhái' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Đánh giá giả mạo' })).not.toBeInTheDocument();
  });

  it('nói rõ người bị báo cáo không biết ai báo cáo', () => {
    setup();

    expect(screen.getByText(/không biết ai đã gửi báo cáo/)).toBeVisible();
  });

  it('tiếng Anh: tiêu đề, lý do và nút không lẫn chuỗi tiếng Việt', () => {
    setup({ targetType: 'SHOP' }, 'en');

    expect(screen.getByRole('alertdialog', { name: 'Report this shop' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Counterfeit goods' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send report' })).toBeInTheDocument();
  });
});

describe('ReportDialog — chọn và gửi', () => {
  it('chọn lý do, bỏ trống mô tả ⇒ gửi đúng đối tượng + lý do, mô tả là undefined (chưa nhập)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(screen.getByRole('radio', { name: 'Spam hoặc quảng cáo' }));
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      targetType: 'REVIEW',
      targetId: TARGET_ID,
      reasonCode: 'SPAM',
      note: undefined,
    });
  });

  it('mô tả được cắt khoảng trắng hai đầu; ký tự HTML / ICU đi nguyên vào request (chỉ là chữ)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(screen.getByRole('radio', { name: 'Ngôn từ xúc phạm' }));
    // `paste` chứ không `type`: user-event hiểu `{x}` trong `type` là phím điều khiển chứ không phải chữ.
    await user.click(noteBox());
    await user.paste('  <b>xấu</b> {x}  ');
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      reasonCode: 'OFFENSIVE_LANGUAGE',
      note: '<b>xấu</b> {x}',
    });
  });

  it('đổi ý giữa chừng: chỉ lý do chọn sau cùng được gửi', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(screen.getByRole('radio', { name: 'Spam hoặc quảng cáo' }));
    await user.click(screen.getByRole('radio', { name: 'Lộ thông tin cá nhân' }));
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ reasonCode: 'PERSONAL_INFO' });
  });

  it('chưa chọn lý do: báo "Vui lòng chọn lý do báo cáo." và KHÔNG gửi', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(submitButton());

    expect(await screen.findByText('Vui lòng chọn lý do báo cáo.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('chọn "Lý do khác": nhãn đổi thành bắt buộc; bỏ trống mô tả ⇒ báo lỗi và KHÔNG gửi; có mô tả thì gửi được', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    expect(screen.getByLabelText('Mô tả thêm (không bắt buộc)')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Lý do khác' }));
    expect(screen.getByLabelText('Mô tả chi tiết (bắt buộc)')).toBeInTheDocument();

    await user.click(submitButton());
    expect(
      await screen.findByText('Vui lòng mô tả chi tiết khi chọn lý do “Khác”.'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(noteBox(), 'Người bán đòi chuyển khoản riêng');
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      reasonCode: 'OTHER',
      note: 'Người bán đòi chuyển khoản riêng',
    });
  });

  it('"Lý do khác" mà mô tả chỉ có khoảng trắng vẫn bị coi là chưa nhập', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(screen.getByRole('radio', { name: 'Lý do khác' }));
    await user.type(noteBox(), '     ');
    await user.click(submitButton());

    expect(
      await screen.findByText('Vui lòng mô tả chi tiết khi chọn lý do “Khác”.'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('mô tả quá 500 ký tự: báo lỗi, đếm ký tự chuyển đỏ và KHÔNG gửi; đúng 500 thì gửi được', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(screen.getByRole('radio', { name: 'Spam hoặc quảng cáo' }));
    await user.click(noteBox());
    await user.paste('a'.repeat(REPORT_NOTE_MAX_LENGTH + 1));
    await user.click(submitButton());

    expect(await screen.findByText('Mô tả tối đa 500 ký tự.')).toBeInTheDocument();
    expect(screen.getByText('501/500').className).toContain('text-destructive');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(noteBox());
    await user.click(noteBox());
    await user.paste('a'.repeat(REPORT_NOTE_MAX_LENGTH));
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('ký tự điều khiển trong mô tả bị từ chối', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(screen.getByRole('radio', { name: 'Spam hoặc quảng cáo' }));
    await user.click(noteBox());
    await user.paste(`a${String.fromCharCode(0)}b`);
    await user.click(submitButton());

    expect(await screen.findByText('Mô tả có ký tự không hợp lệ.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ReportDialog — đang gửi và lỗi', () => {
  it('đang gửi: nút gửi khoá và báo bận, lý do + mô tả bị khoá, nhãn đổi thành "Đang gửi..."', () => {
    setup({ isPending: true });

    const submit = screen.getByRole('button', { name: 'Đang gửi...' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(noteBox()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeDisabled();
  });

  it('lỗi đã dịch hiện trong hộp thoại (role=alert) và lựa chọn / chữ đã nhập được GIỮ nguyên', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ error: 'Bạn đã có một báo cáo đang chờ xử lý về nội dung này.' });

    await user.click(screen.getByRole('radio', { name: 'Đánh giá giả mạo' }));
    await user.type(noteBox(), 'Nội dung nhái');
    await user.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    expect(screen.getByText('Bạn đã có một báo cáo đang chờ xử lý về nội dung này.')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Đánh giá giả mạo' })).toBeChecked();
    expect(noteBox()).toHaveValue('Nội dung nhái');
  });

  it('lỗi dài không dấu cách ngắt được chữ (không đẩy hộp thoại rộng ra)', () => {
    setup({ error: 'x'.repeat(400) });

    expect(screen.getByText('x'.repeat(400)).className).toContain('[overflow-wrap:anywhere]');
  });
});
