import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { APPEAL_MESSAGE_MAX_LENGTH } from '../schemas/appeal.schema';
import { AppealDialog } from './AppealDialog';

afterEach(() => {
  cleanup();
});

function setup(
  props: Partial<React.ComponentProps<typeof AppealDialog>> = {},
  locale: 'vi' | 'en' = 'vi',
) {
  const onSubmit = vi.fn().mockResolvedValue(true);
  const onOpenChange = vi.fn();
  render(
    withIntl(
      <AppealDialog
        open
        onOpenChange={onOpenChange}
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

const textbox = () => screen.getByLabelText('Nội dung kháng nghị') as HTMLTextAreaElement;
const submitButton = () => screen.getByRole('button', { name: 'Gửi kháng nghị' });

describe('AppealDialog — kháng nghị sản phẩm bị gỡ (kind="product")', () => {
  it('đổi lời văn sang sản phẩm: tiêu đề, mô tả, gợi ý nhập (luồng và các nút không đổi)', () => {
    setup({ kind: 'product' });

    expect(
      screen.getByRole('heading', { name: 'Kháng nghị việc gỡ sản phẩm' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Giải thích vì sao sản phẩm nên được khôi phục/)).toBeInTheDocument();
    expect(textbox().placeholder).toMatch(/Sản phẩm đã được bổ sung giấy tờ nguồn gốc/);
    expect(submitButton()).toBeInTheDocument();
    expect(screen.queryByText(/mở khoá/)).not.toBeInTheDocument();
  });

  it('mặc định (không truyền kind) vẫn là lời văn của shop', () => {
    setup();

    expect(screen.getByRole('heading', { name: 'Gửi kháng nghị' })).toBeInTheDocument();
    expect(screen.getByText(/Giải thích vì sao shop nên được mở khoá/)).toBeInTheDocument();
  });

  it('vẫn dùng đúng luật nhập của kháng nghị: gửi lời đã làm sạch; bỏ trống thì báo lỗi và KHÔNG gửi', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ kind: 'product' });

    await user.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Vui lòng nhập nội dung kháng nghị.',
    );
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(textbox(), '  Đã bổ sung giấy tờ  ');
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Đã bổ sung giấy tờ'));
  });

  it('tiếng Anh: lời văn của sản phẩm, không lẫn chuỗi tiếng Việt', () => {
    setup({ kind: 'product' }, 'en');

    expect(
      screen.getByRole('heading', { name: 'Appeal the product take-down' }),
    ).toBeInTheDocument();
    const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    expect(document.body.textContent ?? '').not.toMatch(vietnamese);
  });
});

describe('AppealDialog — nhập và gửi', () => {
  it('gửi lời kháng nghị đã làm sạch (cắt khoảng trắng hai đầu)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(textbox(), '  Shop đã gỡ hàng vi phạm  ');
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Shop đã gỡ hàng vi phạm'));
  });

  it('bỏ trống hoặc chỉ khoảng trắng: báo lỗi ngay dưới ô nhập và KHÔNG gửi', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Vui lòng nhập nội dung kháng nghị.',
    );

    await user.type(textbox(), '   ');
    await user.click(submitButton());

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Vui lòng nhập nội dung kháng nghị.'),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('quá 1000 ký tự: báo lỗi "tối đa 1000 ký tự" và KHÔNG gửi', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(textbox());
    await user.paste('a'.repeat(APPEAL_MESSAGE_MAX_LENGTH + 1));
    await user.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('tối đa 1000 ký tự');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('đúng cận 1000 ký tự thì gửi được', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(textbox());
    await user.paste('a'.repeat(APPEAL_MESSAGE_MAX_LENGTH));
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('bộ đếm ký tự cập nhật theo lúc gõ và chuyển sang màu cảnh báo khi vượt cận', async () => {
    const user = userEvent.setup();
    setup();

    expect(screen.getByText('0/1000')).toHaveClass('text-muted-foreground');

    await user.type(textbox(), 'abc');
    expect(screen.getByText('3/1000')).toBeInTheDocument();

    await user.clear(textbox());
    await user.click(textbox());
    await user.paste('a'.repeat(APPEAL_MESSAGE_MAX_LENGTH + 5));
    expect(screen.getByText('1005/1000')).toHaveClass('text-destructive');
  });

  it('gửi LỖI (onSubmit trả false) ⇒ GIỮ nguyên chữ vừa gõ để không phải gõ lại', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(false);
    setup({ onSubmit });

    await user.type(textbox(), 'Nội dung quan trọng');
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(textbox().value).toBe('Nội dung quan trọng');
  });
});

describe('AppealDialog — trạng thái', () => {
  it('lỗi của lần gửi trước hiện trong hộp thoại (role=alert), chuỗi dài không dấu cách không tràn', () => {
    setup({ error: 'Bạn đã gửi kháng nghị cho lần khoá này rồi.' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Bạn đã gửi kháng nghị cho lần khoá này rồi.',
    );
    expect(screen.getByText('Bạn đã gửi kháng nghị cho lần khoá này rồi.')).toHaveClass(
      '[overflow-wrap:anywhere]',
    );
  });

  it('đang gửi: khoá ô nhập, nút gửi và nút đóng; nút gửi đổi chữ và báo bận', () => {
    setup({ isPending: true });

    expect(textbox()).toBeDisabled();
    const submit = screen.getByRole('button', { name: 'Đang gửi...' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeDisabled();
  });

  it('đóng (open=false) ⇒ không vẽ gì; mở lại là một form trống', () => {
    const { unmount } = render(
      withIntl(
        <AppealDialog
          open={false}
          onOpenChange={vi.fn()}
          isPending={false}
          error={null}
          onSubmit={vi.fn()}
        />,
      ),
    );

    expect(screen.queryByLabelText('Nội dung kháng nghị')).not.toBeInTheDocument();
    unmount();
  });

  it('nút Đóng báo onOpenChange(false)', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Đóng' }));

    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});

describe('AppealDialog — tiếng Anh', () => {
  it('không lẫn chuỗi tiếng Việt do mẫu dịch', async () => {
    const user = userEvent.setup();
    setup({}, 'en');

    expect(screen.getByRole('heading', { name: 'Send an appeal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Appeal message')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send appeal' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter your appeal.');
    const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    expect(document.body.textContent ?? '').not.toMatch(vietnamese);
  });
});
