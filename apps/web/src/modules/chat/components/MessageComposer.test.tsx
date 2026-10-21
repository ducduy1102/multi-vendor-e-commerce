import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { MessageComposer } from './MessageComposer';

function setup({ disabledReason = null as string | null, locale = 'vi' as 'vi' | 'en' } = {}) {
  const onSend = vi.fn();
  const onTyping = vi.fn();
  const utils = render(
    withIntl(
      <MessageComposer onSend={onSend} onTyping={onTyping} disabledReason={disabledReason} />,
      locale,
    ),
  );
  return { ...utils, onSend, onTyping, box: screen.getByRole('textbox') };
}

const sendButton = () => screen.getByRole('button', { name: 'Gửi' });

describe('MessageComposer', () => {
  it('ban đầu: ô trống, nút gửi tắt, bộ đếm 0/1000, gợi ý phím', () => {
    setup();

    expect(screen.getByLabelText('Nội dung tin nhắn')).toHaveValue('');
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText('0/1000')).toBeInTheDocument();
    expect(screen.getByText('Enter để gửi, Shift+Enter để xuống dòng')).toBeInTheDocument();
  });

  it('Enter gửi tin, xoá ô nhập; onSend nhận nội dung đã trim', async () => {
    const user = userEvent.setup();
    const { box, onSend } = setup();

    await user.type(box, '  xin chào shop  {Enter}');

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith('xin chào shop');
    expect(box).toHaveValue('');
  });

  it('Shift+Enter xuống dòng, KHÔNG gửi; tin nhiều dòng giữ nguyên xuống dòng khi gửi', async () => {
    const user = userEvent.setup();
    const { box, onSend } = setup();

    await user.type(box, 'dòng 1{Shift>}{Enter}{/Shift}dòng 2');
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('dòng 1\ndòng 2');

    await user.click(sendButton());
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('dòng 1\ndòng 2'));
  });

  it('Enter lúc bộ gõ (IME/Telex) đang soạn dở chỉ xác nhận từ, KHÔNG gửi — cả isComposing lẫn keyCode 229 của Safari', async () => {
    const { box, onSend } = setup();
    fireEvent.change(box, { target: { value: 'tiếng việt' } });

    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('tiếng việt');
  });

  it('Enter khi ô trống hoặc chỉ khoảng trắng: bỏ qua, không gửi và không hiện lỗi vô ích', async () => {
    const user = userEvent.setup();
    const { box, onSend } = setup();

    await user.type(box, '{Enter}');
    await user.type(box, '   {Enter}');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it('nút gửi bật khi có chữ và gửi được bằng chuột', async () => {
    const user = userEvent.setup();
    const { box, onSend } = setup();

    await user.type(box, 'a');
    expect(sendButton()).toBeEnabled();
    await user.click(sendButton());

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('a'));
  });

  it('bộ đếm theo độ dài thật; quá 1000 ký tự: bộ đếm báo lỗi, gửi bị chặn bằng lỗi theo field và KHÔNG cắt cụt âm thầm', async () => {
    const user = userEvent.setup();
    const { box, onSend } = setup();

    fireEvent.change(box, { target: { value: 'a'.repeat(1001) } });
    expect(screen.getByText('1001/1000')).toHaveClass('text-destructive');

    await user.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Tin nhắn tối đa 1000 ký tự');
    expect(onSend).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toHaveLength(1001);
  });

  it('đúng 1000 ký tự gửi được', async () => {
    const user = userEvent.setup();
    const { box, onSend } = setup();

    fireEvent.change(box, { target: { value: 'a'.repeat(1000) } });
    await user.click(sendButton());

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('a'.repeat(1000)));
  });

  it('chuỗi 1000 ký tự liền không dấu cách (ca xấu nhất) gửi nguyên vẹn', async () => {
    const user = userEvent.setup();
    const { box, onSend } = setup();
    const worstCase = 'x'.repeat(1000);

    fireEvent.change(box, { target: { value: worstCase } });
    await user.click(sendButton());

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(worstCase));
  });

  it('ký tự điều khiển/bidi bị chặn theo schema dùng chung với BE', async () => {
    const user = userEvent.setup();
    const { box, onSend } = setup();

    fireEvent.change(box, { target: { value: 'chào‮evil' } });
    await user.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tin nhắn chứa ký tự không được phép',
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it('mỗi lần gõ gọi onTyping (nơi gọi tự giới hạn tần suất)', async () => {
    const user = userEvent.setup();
    const { box, onTyping } = setup();

    await user.type(box, 'abc');

    expect(onTyping).toHaveBeenCalledTimes(3);
  });

  it('bị vô hiệu có lý do: ô nhập + nút gửi tắt, lý do hiện bằng CHỮ, Enter không gửi', async () => {
    const { box, onSend } = setup({ disabledReason: 'Shop hiện không nhận tin nhắn mới.' });

    expect(box).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Shop hiện không nhận tin nhắn mới.');
    expect(screen.queryByText('Enter để gửi, Shift+Enter để xuống dòng')).not.toBeInTheDocument();

    fireEvent.keyDown(box, { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('đang soạn dở thì hội thoại bị khoá chỉ-đọc: Enter và nút gửi đều KHÔNG gửi bản nháp', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const view = render(withIntl(<MessageComposer onSend={onSend} disabledReason={null} />));
    await user.type(screen.getByRole('textbox'), 'bản nháp');

    view.rerender(
      withIntl(
        <MessageComposer onSend={onSend} disabledReason="Shop hiện không nhận tin nhắn mới." />,
      ),
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    fireEvent.submit(screen.getByRole('textbox').closest('form') as HTMLFormElement);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('bản tiếng Anh dùng nhãn tiếng Anh', () => {
    setup({ locale: 'en' });

    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
  });
});
