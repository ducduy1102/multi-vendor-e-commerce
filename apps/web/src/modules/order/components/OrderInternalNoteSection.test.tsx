import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { OrderInternalNoteSection } from './OrderInternalNoteSection';

type Props = React.ComponentProps<typeof OrderInternalNoteSection>;

function setup(props: Partial<Props> = {}, locale: 'vi' | 'en' = 'vi') {
  // Mặc định lưu thành công và BE trả lại đúng nội dung vừa gửi (đã chuẩn hoá).
  const onSave = vi.fn(async (note: string): Promise<string | null> => note);
  const base: Props = { note: null, isSaving: false, isSaved: false, error: null, onSave };
  const utils = render(withIntl(<OrderInternalNoteSection {...base} {...props} />, locale));
  const rerender = (next: Partial<Props>, nextLocale: 'vi' | 'en' = locale) =>
    utils.rerender(
      withIntl(<OrderInternalNoteSection {...base} {...props} {...next} />, nextLocale),
    );
  return { ...utils, onSave: (props.onSave as typeof onSave | undefined) ?? onSave, rerender };
}

const textbox = () => screen.getByLabelText('Ghi chú nội bộ của đơn') as HTMLTextAreaElement;
const saveButton = () => screen.getByRole('button', { name: /Lưu ghi chú|Đang lưu/ });

describe('OrderInternalNoteSection — nhập và lưu', () => {
  it('có tiêu đề, lời nhắc "chỉ shop thấy" và ô nhập đặt sẵn ghi chú hiện có', () => {
    setup({ note: 'Hàng dễ vỡ' });

    expect(screen.getByRole('region', { name: 'Ghi chú nội bộ' })).toBeInTheDocument();
    expect(
      screen.getByText('Chỉ shop của bạn thấy ghi chú này, người mua không bao giờ thấy.'),
    ).toBeInTheDocument();
    expect(textbox().value).toBe('Hàng dễ vỡ');
  });

  it('LƯU BẰNG NÚT: chưa sửa gì thì nút khoá; gõ tiếp thì bật; gõ chữ KHÔNG tự gọi onSave', async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ note: 'Hàng dễ vỡ' });
    expect(saveButton()).toBeDisabled();

    await user.type(textbox(), ' - bọc kỹ');

    expect(saveButton()).toBeEnabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('bấm Lưu gọi onSave với nội dung đã làm sạch (cắt khoảng trắng hai đầu)', async () => {
    const user = userEvent.setup();
    const { onSave } = setup();

    await user.type(textbox(), '  Đã gọi khách  ');
    await user.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Đã gọi khách'));
  });

  it('xoá hết chữ rồi Lưu ⇒ onSave("") — đó là cách xoá ghi chú', async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ note: 'sẽ bị xoá' });

    await user.clear(textbox());
    await user.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(''));
  });

  it('quá 500 ký tự: báo lỗi theo field và KHÔNG gọi onSave', async () => {
    const user = userEvent.setup();
    const { onSave } = setup();

    await user.click(textbox());
    await user.paste('a'.repeat(501));
    await user.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Ghi chú tối đa 500 ký tự');
    expect(textbox()).toHaveAttribute('aria-invalid', 'true');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('ký tự điều khiển (NUL): báo "không hợp lệ" và KHÔNG gọi onSave', async () => {
    const user = userEvent.setup();
    const { onSave } = setup();

    await user.click(textbox());
    await user.paste(`abc${String.fromCharCode(0)}def`);
    await user.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Ghi chú chứa ký tự không hợp lệ');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('bộ đếm ký tự cập nhật và đổi sang màu cảnh báo khi vượt cận', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByText('0/500')).toHaveClass('text-muted-foreground');

    await user.type(textbox(), 'abc');
    expect(screen.getByText('3/500')).toBeInTheDocument();

    await user.click(textbox());
    await user.paste('a'.repeat(500));
    expect(screen.getByText('503/500')).toHaveClass('text-destructive');
  });
});

describe('OrderInternalNoteSection — kết quả lưu', () => {
  it('BE trả bản ĐÃ chuẩn hoá ⇒ ô nhập nhận đúng bản đó và nút Lưu khoá lại (không còn "đã sửa")', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => 'Đã gọi khách');
    setup({ onSave });

    await user.type(textbox(), '  Đã gọi khách  ');
    await user.click(saveButton());

    await waitFor(() => expect(textbox().value).toBe('Đã gọi khách'));
    expect(saveButton()).toBeDisabled();
  });

  it('xoá ghi chú: BE trả chuỗi rỗng ⇒ ô nhập rỗng và nút Lưu khoá', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => '');
    setup({ note: 'sẽ bị xoá', onSave });

    await user.clear(textbox());
    await user.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(''));
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(textbox().value).toBe('');
  });

  it('lưu LỖI (onSave trả null): GIỮ nguyên chữ đang gõ và nút Lưu vẫn bật để thử lại', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => null);
    setup({ note: 'bản cũ', onSave });

    await user.type(textbox(), ' + sửa dở');
    await user.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(textbox().value).toBe('bản cũ + sửa dở');
    expect(saveButton()).toBeEnabled();
  });
});

describe('OrderInternalNoteSection — trạng thái lưu', () => {
  it('đang lưu: ô nhập và nút khoá, nút báo bận và đổi chữ', () => {
    setup({ note: 'x', isSaving: true });

    expect(textbox()).toBeDisabled();
    const button = screen.getByRole('button', { name: 'Đang lưu...' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('lưu lỗi: hiện lỗi trong khung cảnh báo và GIỮ nguyên chữ đang gõ', async () => {
    const user = userEvent.setup();
    setup({ error: 'Không tìm thấy đơn hàng này.' });
    await user.type(textbox(), 'chữ chưa lưu');

    expect(screen.getByRole('alert')).toHaveTextContent('Không tìm thấy đơn hàng này.');
    expect(textbox().value).toBe('chữ chưa lưu');
  });

  it('vừa lưu xong (isSaved, chưa sửa tiếp): hiện "Đã lưu"; sửa tiếp thì mất', async () => {
    const user = userEvent.setup();
    setup({ note: 'đã lưu', isSaved: true });
    expect(screen.getByRole('status')).toHaveTextContent('Đã lưu');

    await user.type(textbox(), '!');

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('chưa lưu lần nào ⇒ KHÔNG hiện "Đã lưu"; vùng trạng thái vẫn có trong DOM (trình đọc màn hình đọc được thay đổi)', () => {
    setup({ note: 'cũ', isSaved: false });

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('OrderInternalNoteSection — dữ liệu đổi sau khi mount', () => {
  it('giá trị đã lưu đổi (sau khi lưu / tải lại) và người dùng CHƯA sửa ⇒ ô nhập theo giá trị mới', async () => {
    const { rerender } = setup({ note: 'bản cũ' });

    rerender({ note: 'bản mới từ BE' });

    await waitFor(() => expect(textbox().value).toBe('bản mới từ BE'));
    expect(saveButton()).toBeDisabled();
  });

  it('người dùng ĐANG gõ dở thì một lần làm mới KHÔNG xoá chữ đang gõ', async () => {
    const user = userEvent.setup();
    const { rerender } = setup({ note: 'bản cũ' });
    await user.type(textbox(), ' + đang gõ');

    rerender({ note: 'bản cũ' });
    rerender({ note: 'bản khác do tab khác lưu' });

    expect(textbox().value).toBe('bản cũ + đang gõ');
  });

  it('bản tiếng Anh: tiêu đề, nút, trạng thái và lỗi không lẫn tiếng Việt', async () => {
    const user = userEvent.setup();
    setup({ note: 'x', isSaved: true }, 'en');

    expect(screen.getByRole('region', { name: 'Internal note' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    await user.click(screen.getByLabelText('Internal note for this order'));
    await user.paste('a'.repeat(501));
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The note must be at most 500 characters',
    );
    expect(document.body.textContent).not.toMatch(/Ghi chú|Lưu|Đã/);
  });
});
