import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ShopStatusBanner } from './ShopStatusBanner';

describe('ShopStatusBanner', () => {
  it('shop đã duyệt -> không hiện gì', () => {
    const { container } = render(withIntl(<ShopStatusBanner status="APPROVED" reason={null} />));

    expect(container).toBeEmptyDOMElement();
  });

  it('chờ duyệt -> thông báo chờ duyệt, không có dòng lý do', () => {
    render(withIntl(<ShopStatusBanner status="PENDING" reason={null} />));

    expect(screen.getByRole('alert')).toHaveTextContent(/đang chờ duyệt/);
    expect(screen.queryByText(/^Lý do:/)).not.toBeInTheDocument();
  });

  it('bị từ chối -> thông báo từ chối kèm lý do của Admin', () => {
    render(withIntl(<ShopStatusBanner status="REJECTED" reason="Thiếu giấy phép kinh doanh" />));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/đã bị từ chối duyệt/);
    expect(alert).toHaveTextContent('Lý do: Thiếu giấy phép kinh doanh');
  });

  it('bị khoá -> thông báo đình chỉ kèm lý do của Admin', () => {
    render(withIntl(<ShopStatusBanner status="SUSPENDED" reason="Bán hàng cấm" />));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/đang bị đình chỉ/);
    expect(alert).toHaveTextContent('Lý do: Bán hàng cấm');
  });

  it('bị từ chối/khoá nhưng chưa có lý do (dữ liệu cũ) -> vẫn hiện thông báo, không có dòng "Lý do:" rỗng', () => {
    render(withIntl(<ShopStatusBanner status="SUSPENDED" reason={null} />));

    expect(screen.getByRole('alert')).toHaveTextContent(/đang bị đình chỉ/);
    expect(screen.queryByText(/^Lý do:/)).not.toBeInTheDocument();
  });

  it('lý do chứa HTML hiện nguyên dạng text, không chèn thẻ vào trang', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const { container } = render(withIntl(<ShopStatusBanner status="REJECTED" reason={payload} />));

    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText(`Lý do: ${payload}`)).toBeInTheDocument();
  });

  it('lý do dài không làm tràn banner (break-words)', () => {
    render(withIntl(<ShopStatusBanner status="REJECTED" reason={'a'.repeat(500)} />));

    expect(screen.getByText(/^Lý do:/)).toHaveClass('break-words');
  });
});
