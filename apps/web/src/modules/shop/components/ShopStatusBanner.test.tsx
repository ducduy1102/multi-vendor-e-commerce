import { SHOP_CASCADE_SUSPEND_REASON } from '@ecommerce/types';
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

  it('bị từ chối -> nói đúng việc cần làm (sửa rồi gửi duyệt lại) kèm lý do của Admin', () => {
    render(withIntl(<ShopStatusBanner status="REJECTED" reason="Thiếu giấy phép kinh doanh" />));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/chưa được duyệt/);
    expect(alert).toHaveTextContent(/gửi duyệt lại/);
    expect(alert).toHaveTextContent('Lý do: Thiếu giấy phép kinh doanh');
  });

  it('bị khoá -> nêu rõ hạn chế (ẩn sản phẩm, không nhận đơn mới) và việc vẫn làm được (xử lý đơn đã có), kèm lý do', () => {
    render(withIntl(<ShopStatusBanner status="SUSPENDED" reason="Bán hàng cấm" />));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/khoá tạm thời/);
    expect(alert).toHaveTextContent(/sản phẩm không hiển thị công khai/);
    expect(alert).toHaveTextContent(/không nhận đơn mới/);
    expect(alert).toHaveTextContent(/vẫn xử lý được các đơn hàng đã có/);
    expect(alert).toHaveTextContent('Lý do: Bán hàng cấm');
  });

  it('banner từ chối KHÔNG còn hứa suông "cập nhật lại thông tin hoặc liên hệ quản trị viên"', () => {
    render(withIntl(<ShopStatusBanner status="REJECTED" reason="x" />));

    expect(screen.getByRole('alert')).not.toHaveTextContent(/liên hệ quản trị viên/);
  });

  it('bị từ chối/khoá nhưng chưa có lý do (dữ liệu cũ) -> vẫn hiện thông báo, không có dòng "Lý do:" rỗng', () => {
    render(withIntl(<ShopStatusBanner status="SUSPENDED" reason={null} />));

    expect(screen.getByRole('alert')).toHaveTextContent(/khoá tạm thời/);
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

  it('shop bị TỰ ĐỘNG tạm ngừng vì tài khoản chủ shop bị khoá/cấm: hiện câu giải thích thay vì mã thô', () => {
    render(withIntl(<ShopStatusBanner status="SUSPENDED" reason={SHOP_CASCADE_SUSPEND_REASON} />));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/tài khoản của bạn đang bị khoá hoặc bị cấm/);
    expect(alert).toHaveTextContent(/email/);
    expect(alert).not.toHaveTextContent(/OWNER_ACCOUNT_SUSPENDED/);
    expect(screen.queryByText(/^Lý do:/)).not.toBeInTheDocument();
  });

  it('bản tiếng Anh của lý do tự động: không lộ tiếng Việt, không lộ mã thô', () => {
    render(
      withIntl(<ShopStatusBanner status="SUSPENDED" reason={SHOP_CASCADE_SUSPEND_REASON} />, 'en'),
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/your account is suspended or banned/);
    expect(alert).not.toHaveTextContent(/OWNER_ACCOUNT_SUSPENDED|tài khoản/);
  });
});
