import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ProductTakenDownNotice } from './ProductTakenDownNotice';

afterEach(() => cleanup());

function setup(
  reason: string | null = 'Bán hàng cấm: dao bấm tự động.',
  locale: 'vi' | 'en' = 'vi',
) {
  render(
    withIntl(<ProductTakenDownNotice productName="Dao bấm tự động" reason={reason} />, locale),
  );
}

describe('ProductTakenDownNotice (Week11.md 5.7)', () => {
  it('nói rõ sản phẩm đã bị sàn gỡ, nêu LÝ DO từ sàn và tên sản phẩm', () => {
    setup();

    expect(screen.getByRole('alert')).toHaveTextContent('Sản phẩm này đã bị sàn gỡ');
    // Tông cảnh báo (destructive) — khác thông báo trung tính.
    expect(screen.getByRole('alert').className).toContain('text-destructive');
    expect(screen.getByText('Lý do từ sàn: Bán hàng cấm: dao bấm tự động.')).toBeInTheDocument();
    expect(screen.getByText('Dao bấm tự động')).toBeInTheDocument();
  });

  it('nói chủ shop không thể sửa / xuất bản / lưu trữ và chỉ ra nơi liên hệ khi cho là nhầm lẫn', () => {
    setup();

    expect(
      screen.getByText(/Bạn không thể sửa, xuất bản hay lưu trữ sản phẩm này/),
    ).toBeInTheDocument();
    expect(screen.getByText(/liên hệ bộ phận hỗ trợ của sàn/)).toBeInTheDocument();
  });

  it('KHÔNG dựng form: không ô nhập, không nút lưu / xuất bản — chỉ một đường về danh sách', () => {
    setup();

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về danh sách sản phẩm' })).toHaveAttribute(
      'href',
      '/seller/products',
    );
  });

  it('không có lý do (dữ liệu lệch) ⇒ vẫn hiện thông báo, không in dòng lý do rỗng', () => {
    setup(null);

    expect(screen.getByRole('alert')).toHaveTextContent('Sản phẩm này đã bị sàn gỡ');
    expect(screen.queryByText(/Lý do từ sàn/)).not.toBeInTheDocument();
  });

  it('lý do là văn bản người khác nhập: in nguyên văn (không diễn giải HTML / ICU) và có lớp bẻ chuỗi dài', () => {
    const reason = '<img src=x onerror=alert(1)> {count, plural, other {#}} ' + 'x'.repeat(300);
    setup(reason);

    const line = screen.getByText(`Lý do từ sàn: ${reason}`);
    expect(line.className).toContain('[overflow-wrap:anywhere]');
    expect(document.querySelector('img')).toBeNull();
  });

  it('có bản tiếng Anh đầy đủ, không lẫn chuỗi tiếng Việt do mẫu dịch', () => {
    setup('Prohibited item.', 'en');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This product was taken down by the marketplace',
    );
    expect(screen.getByText('Reason from the marketplace: Prohibited item.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to my products' })).toBeInTheDocument();
  });
});
