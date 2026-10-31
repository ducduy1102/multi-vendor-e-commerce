import { REPORT_RESOLUTION_NOTE_MAX_LENGTH } from '@ecommerce/types';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import {
  makeConversationReport,
  makeProductReport,
  makeReviewReport,
  makeShopReport,
} from '../admin-report.fixtures';
import type { AdminReport } from '../types';
import { AdminReportActionPanel } from './AdminReportActionPanel';

afterEach(() => cleanup());

function setup(
  report: AdminReport = makeReviewReport(),
  props: Partial<React.ComponentProps<typeof AdminReportActionPanel>> = {},
  locale: 'vi' | 'en' = 'vi',
) {
  const onRequest = vi.fn();
  render(
    withIntl(
      <AdminReportActionPanel report={report} isPending={false} onRequest={onRequest} {...props} />,
      locale,
    ),
  );
  return { onRequest: (props.onRequest as typeof onRequest | undefined) ?? onRequest };
}

const noteBox = () => screen.getByLabelText(/^Ghi chú xử lý/) as HTMLTextAreaElement;
const radio = (name: string | RegExp) => screen.getByRole('radio', { name });

describe('AdminReportActionPanel — các hành động theo loại', () => {
  it.each([
    ['đánh giá', makeReviewReport(), ['Ẩn đánh giá', 'Bỏ qua']],
    ['shop', makeShopReport(), ['Khoá shop', 'Bỏ qua']],
    ['sản phẩm', makeProductReport(), ['Gỡ sản phẩm', 'Bỏ qua']],
    ['hội thoại', makeConversationReport(), ['Khoá tài khoản bị báo', 'Bỏ qua']],
  ])(
    '%s: đúng các lựa chọn dùng được, KHÔNG có hành động của loại khác',
    (_name, report, labels) => {
      setup(report);

      const names = screen
        .getAllByRole('radio')
        .map((el) => el.closest('label')?.textContent ?? '');
      expect(names).toHaveLength(labels.length);
      labels.forEach((label, index) => expect(names[index]).toContain(label));
    },
  );

  it('lựa chọn đầu tiên được chọn sẵn; chọn cái khác thì chỉ cái đó được chọn', async () => {
    const user = userEvent.setup();
    setup(makeReviewReport());

    expect(radio(/Ẩn đánh giá/)).toBeChecked();
    expect(radio(/Bỏ qua/)).not.toBeChecked();

    await user.click(radio(/Bỏ qua/));

    expect(radio(/Bỏ qua/)).toBeChecked();
    expect(radio(/Ẩn đánh giá/)).not.toBeChecked();
  });

  it('nút gửi đổi theo hành động đang chọn (có dấu … vì còn hộp thoại xác nhận)', async () => {
    const user = userEvent.setup();
    setup(makeShopReport());

    expect(screen.getByRole('button', { name: 'Khoá shop…' })).toBeInTheDocument();
    await user.click(radio(/Bỏ qua/));

    expect(screen.getByRole('button', { name: 'Bỏ qua báo cáo…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Khoá shop…' })).not.toBeInTheDocument();
  });

  it('hành động huỷ bỏ có nút viền cảnh báo; "Bỏ qua" thì không', async () => {
    const user = userEvent.setup();
    setup(makeReviewReport());

    expect(screen.getByRole('button', { name: 'Ẩn đánh giá…' }).className).toContain(
      'text-destructive',
    );
    await user.click(radio(/Bỏ qua/));
    expect(screen.getByRole('button', { name: 'Bỏ qua báo cáo…' }).className).not.toContain(
      'text-destructive',
    );
  });

  it.each([
    ['shop', makeShopReport(), 'Khoá shop…'],
    ['sản phẩm', makeProductReport(), 'Gỡ sản phẩm…'],
    ['hội thoại', makeConversationReport(), 'Khoá tài khoản…'],
  ])('báo cáo %s: nút hành động chính cũng là nút viền cảnh báo', (_name, report, label) => {
    setup(report);

    expect(screen.getByRole('button', { name: label }).className).toContain('text-destructive');
  });
});

describe('AdminReportActionPanel — ghi chú: ai đọc, bắt buộc hay không', () => {
  it.each([
    [
      'đánh giá',
      makeReviewReport(),
      'Ghi chú hiển thị cho tác giả và chủ shop. Đừng nêu thông tin người báo cáo.',
    ],
    ['shop', makeShopReport(), 'Ghi chú hiển thị cho chủ shop. Đừng nêu thông tin người báo cáo.'],
    // Ghi chú gỡ sản phẩm là LÝ DO chủ shop đọc ở trang sửa, danh sách sản phẩm và thông báo (Week11.md 5.7).
    [
      'sản phẩm',
      makeProductReport(),
      'Ghi chú hiển thị cho chủ shop. Đừng nêu thông tin người báo cáo.',
    ],
    [
      'hội thoại',
      makeConversationReport(),
      'Ghi chú hiển thị cho người bị khoá. Đừng nêu thông tin người báo cáo.',
    ],
  ])(
    '%s: câu gợi ý nói đúng AI sẽ đọc ghi chú và dặn không nêu người báo',
    (_name, report, hint) => {
      setup(report);

      expect(screen.getByText(hint)).toBeInTheDocument();
    },
  );

  it('"Bỏ qua": ghi chú không bắt buộc, nhãn đổi và KHÔNG có câu gợi ý hiển thị cho ai', async () => {
    const user = userEvent.setup();
    setup(makeReviewReport());
    expect(screen.getByLabelText('Ghi chú xử lý')).toBeInTheDocument();

    await user.click(radio(/Bỏ qua/));

    expect(screen.getByLabelText('Ghi chú xử lý (không bắt buộc)')).toBeInTheDocument();
    expect(screen.queryByText(/Ghi chú hiển thị cho/)).not.toBeInTheDocument();
  });

  it('hành động huỷ bỏ mà bỏ trống ghi chú ⇒ báo lỗi dưới ô nhập và KHÔNG gửi', async () => {
    const user = userEvent.setup();
    const { onRequest } = setup(makeReviewReport());

    await user.click(screen.getByRole('button', { name: 'Ẩn đánh giá…' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do xử lý.');
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('chỉ khoảng trắng cũng bị coi là chưa nhập', async () => {
    const user = userEvent.setup();
    const { onRequest } = setup(makeShopReport());

    await user.type(noteBox(), '    ');
    await user.click(screen.getByRole('button', { name: 'Khoá shop…' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do xử lý.');
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('có ghi chú ⇒ gửi đúng { action, note } đã cắt khoảng trắng hai đầu', async () => {
    const user = userEvent.setup();
    const { onRequest } = setup(makeReviewReport());

    await user.type(noteBox(), '  Ngôn từ xúc phạm người bán.  ');
    await user.click(screen.getByRole('button', { name: 'Ẩn đánh giá…' }));

    await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(1));
    expect(onRequest.mock.calls[0][0]).toEqual({
      action: 'HIDE_REVIEW',
      note: 'Ngôn từ xúc phạm người bán.',
    });
  });

  it('"Bỏ qua" không cần ghi chú: gửi { action: DISMISS, note: undefined }', async () => {
    const user = userEvent.setup();
    const { onRequest } = setup(makeReviewReport());

    await user.click(radio(/Bỏ qua/));
    await user.click(screen.getByRole('button', { name: 'Bỏ qua báo cáo…' }));

    await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(1));
    expect(onRequest.mock.calls[0][0]).toEqual({ action: 'DISMISS', note: undefined });
  });

  it('ghi chú quá giới hạn: báo lỗi, đếm ký tự chuyển đỏ, KHÔNG gửi', async () => {
    const user = userEvent.setup();
    const { onRequest } = setup(makeReviewReport());

    await user.click(noteBox());
    await user.paste('a'.repeat(REPORT_RESOLUTION_NOTE_MAX_LENGTH + 1));
    await user.click(screen.getByRole('button', { name: 'Ẩn đánh giá…' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText(
        `${REPORT_RESOLUTION_NOTE_MAX_LENGTH + 1}/${REPORT_RESOLUTION_NOTE_MAX_LENGTH}`,
      ).className,
    ).toContain('text-destructive');
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('ký tự HTML / ICU trong ghi chú đi nguyên văn vào request (chỉ là chữ)', async () => {
    const user = userEvent.setup();
    const { onRequest } = setup(makeReviewReport());

    await user.click(noteBox());
    await user.paste('<img src=x onerror=alert(1)> {x}');
    await user.click(screen.getByRole('button', { name: 'Ẩn đánh giá…' }));

    await waitFor(() => expect(onRequest).toHaveBeenCalled());
    expect(onRequest.mock.calls[0][0].note).toBe('<img src=x onerror=alert(1)> {x}');
  });
});

describe('AdminReportActionPanel — hệ quả, lỗi, đang gửi', () => {
  it('nêu số báo cáo sẽ đóng cùng; không có ai khác thì nói chỉ đóng báo cáo này', () => {
    setup(makeReviewReport({ sameTargetOpenCount: 3 }));
    expect(screen.getByText('Sẽ đóng thêm 3 báo cáo về cùng đối tượng.')).toBeInTheDocument();

    // Ranh giới: đúng MỘT báo cáo khác đã là "đóng thêm", chỉ 0 mới là "chỉ đóng báo cáo này".
    cleanup();
    setup(makeReviewReport({ sameTargetOpenCount: 1 }));
    expect(screen.getByText('Sẽ đóng thêm 1 báo cáo về cùng đối tượng.')).toBeInTheDocument();

    cleanup();
    setup(makeReviewReport({ sameTargetOpenCount: 0 }));
    expect(screen.getByText('Chỉ đóng báo cáo này.')).toBeInTheDocument();
  });

  it('đang gửi: khoá lựa chọn, ô ghi chú và nút gửi', () => {
    setup(makeReviewReport(), { isPending: true });

    for (const el of screen.getAllByRole('radio')) expect(el).toBeDisabled();
    expect(noteBox()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ẩn đánh giá…' })).toBeDisabled();
  });

  it('tiếng Anh: không lẫn chuỗi tiếng Việt', () => {
    setup(makeReviewReport(), {}, 'en');

    expect(screen.getByText('Handle report')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide review…' })).toBeInTheDocument();
    expect(screen.getByText(/shown to the author and the shop owner/)).toBeInTheDocument();
  });
});
