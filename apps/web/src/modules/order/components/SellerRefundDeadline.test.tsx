import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import en from '../../../../messages/en.json';

import { SellerRefundDeadline } from './SellerRefundDeadline';

const RESPOND_BY = '2026-10-03T03:00:00.000Z';

// Hạn + hệ quả nếu im lặng: shop cần biết CẢ HAI thì mới quyết định kịp. Hệ quả khác nhau theo loại yêu cầu
// (hủy ⇒ đơn tự hủy, trả hàng ⇒ chuyển lên sàn) — nhầm câu giữa hai loại là hiểu sai hậu quả nên có test riêng.
describe('SellerRefundDeadline', () => {
  it('yêu cầu HỦY: hiện hạn phản hồi và câu "đơn sẽ tự động bị hủy"', () => {
    render(withIntl(<SellerRefundDeadline kind="CANCEL" respondBy={RESPOND_BY} />));

    expect(screen.getByText(/Hạn phản hồi: .*2026/)).toBeInTheDocument();
    expect(
      screen.getByText('Quá hạn mà chưa phản hồi, đơn sẽ tự động bị hủy.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/chuyển lên sàn xử lý/)).not.toBeInTheDocument();
  });

  it('yêu cầu TRẢ HÀNG: hiện hạn phản hồi và câu "chuyển lên sàn xử lý" (không tự hủy, không tự duyệt)', () => {
    render(withIntl(<SellerRefundDeadline kind="RETURN" respondBy={RESPOND_BY} />));

    expect(screen.getByText(/Hạn phản hồi: .*2026/)).toBeInTheDocument();
    expect(
      screen.getByText('Quá hạn mà chưa phản hồi, yêu cầu sẽ được chuyển lên sàn xử lý.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/tự động bị hủy/)).not.toBeInTheDocument();
  });

  it('hạn là mốc cố định lấy từ BE, không phải "còn bao lâu" tính theo đồng hồ máy (không có chữ "còn")', () => {
    render(withIntl(<SellerRefundDeadline kind="CANCEL" respondBy={RESPOND_BY} />));

    expect(screen.queryByText(/còn \d/)).not.toBeInTheDocument();
  });

  it('en: "Respond by …" và đúng câu hệ quả của từng loại', () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SellerRefundDeadline kind="CANCEL" respondBy={RESPOND_BY} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText(/Respond by .*2026/)).toBeInTheDocument();
    expect(
      screen.getByText("If you don't respond in time, the order will be cancelled automatically."),
    ).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <SellerRefundDeadline kind="RETURN" respondBy={RESPOND_BY} />
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByText("If you don't respond in time, the request will be passed to the platform."),
    ).toBeInTheDocument();
  });
});
