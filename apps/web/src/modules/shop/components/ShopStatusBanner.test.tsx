import { SHOP_CASCADE_SUSPEND_REASON } from '@ecommerce/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ShopStatusBanner } from './ShopStatusBanner';

describe('ShopStatusBanner', () => {
  it('shop đã duyệt -> không hiện gì', () => {
    const { container } = render(
      withIntl(<ShopStatusBanner status="APPROVED" reason={null} supportEmail={null} />),
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('chờ duyệt -> thông báo chờ duyệt, không có dòng lý do', () => {
    render(withIntl(<ShopStatusBanner status="PENDING" reason={null} supportEmail={null} />));

    expect(screen.getByRole('alert')).toHaveTextContent(/đang chờ duyệt/);
    expect(screen.queryByText(/^Lý do:/)).not.toBeInTheDocument();
  });

  it('bị từ chối -> nói đúng việc cần làm (sửa rồi gửi duyệt lại) kèm lý do của Admin', () => {
    render(
      withIntl(
        <ShopStatusBanner
          status="REJECTED"
          reason="Thiếu giấy phép kinh doanh"
          supportEmail={null}
        />,
      ),
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/chưa được duyệt/);
    expect(alert).toHaveTextContent(/gửi duyệt lại/);
    expect(alert).toHaveTextContent('Lý do: Thiếu giấy phép kinh doanh');
  });

  it('bị khoá -> nêu rõ hạn chế (ẩn sản phẩm, không nhận đơn mới) và việc vẫn làm được (xử lý đơn đã có), kèm lý do', () => {
    render(
      withIntl(<ShopStatusBanner status="SUSPENDED" reason="Bán hàng cấm" supportEmail={null} />),
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/khoá tạm thời/);
    expect(alert).toHaveTextContent(/sản phẩm không hiển thị công khai/);
    expect(alert).toHaveTextContent(/không nhận đơn mới/);
    expect(alert).toHaveTextContent(/vẫn xử lý được các đơn hàng đã có/);
    expect(alert).toHaveTextContent('Lý do: Bán hàng cấm');
  });

  it('banner từ chối KHÔNG còn hứa suông "cập nhật lại thông tin hoặc liên hệ quản trị viên"', () => {
    render(withIntl(<ShopStatusBanner status="REJECTED" reason="x" supportEmail={null} />));

    expect(screen.getByRole('alert')).not.toHaveTextContent(/liên hệ quản trị viên/);
  });

  it('bị từ chối/khoá nhưng chưa có lý do (dữ liệu cũ) -> vẫn hiện thông báo, không có dòng "Lý do:" rỗng', () => {
    render(withIntl(<ShopStatusBanner status="SUSPENDED" reason={null} supportEmail={null} />));

    expect(screen.getByRole('alert')).toHaveTextContent(/khoá tạm thời/);
    expect(screen.queryByText(/^Lý do:/)).not.toBeInTheDocument();
  });

  it('lý do chứa HTML hiện nguyên dạng text, không chèn thẻ vào trang', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const { container } = render(
      withIntl(<ShopStatusBanner status="REJECTED" reason={payload} supportEmail={null} />),
    );

    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText(`Lý do: ${payload}`)).toBeInTheDocument();
  });

  it('lý do dài không làm tràn banner (break-words)', () => {
    render(
      withIntl(<ShopStatusBanner status="REJECTED" reason={'a'.repeat(500)} supportEmail={null} />),
    );

    expect(screen.getByText(/^Lý do:/)).toHaveClass('break-words');
  });

  // jsdom không có bố cục nên chỉ khoá được cặp lớp; việc đo thật (scrollWidth ở 390px) làm bằng Playwright. Đã gặp: lý do 500 ký
  // tự liền làm cột `auto` của lưới rộng ~3956px, cả trang tràn ngang.
  it('khung banner khai cột tường minh (grid-cols-1) để lý do dài không kéo rộng cả cột lưới', () => {
    render(
      withIntl(<ShopStatusBanner status="REJECTED" reason={'a'.repeat(500)} supportEmail={null} />),
    );

    expect(screen.getByRole('alert')).toHaveClass('grid-cols-1');
  });

  it('shop bị TỰ ĐỘNG tạm ngừng vì tài khoản chủ shop bị khoá/cấm: hiện câu giải thích thay vì mã thô', () => {
    render(
      withIntl(
        <ShopStatusBanner
          status="SUSPENDED"
          reason={SHOP_CASCADE_SUSPEND_REASON}
          supportEmail={null}
        />,
      ),
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/tài khoản của bạn đang bị khoá hoặc bị cấm/);
    expect(alert).toHaveTextContent(/email/);
    expect(alert).not.toHaveTextContent(/OWNER_ACCOUNT_SUSPENDED/);
    expect(screen.queryByText(/^Lý do:/)).not.toBeInTheDocument();
  });

  it('bản tiếng Anh của lý do tự động: không lộ tiếng Việt, không lộ mã thô', () => {
    render(
      withIntl(
        <ShopStatusBanner
          status="SUSPENDED"
          reason={SHOP_CASCADE_SUSPEND_REASON}
          supportEmail={null}
        />,
        'en',
      ),
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/your account is suspended or banned/);
    expect(alert).not.toHaveTextContent(/OWNER_ACCOUNT_SUSPENDED|tài khoản/);
  });

  describe('dòng liên hệ hỗ trợ (Week11.md 4.2)', () => {
    const SUPPORT = 'support@example.com';

    it.each(['REJECTED', 'SUSPENDED'] as const)(
      '%s + có địa chỉ hỗ trợ -> "Liên hệ hỗ trợ: <link mailto>"',
      (status) => {
        render(withIntl(<ShopStatusBanner status={status} reason="x" supportEmail={SUPPORT} />));

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(`Liên hệ hỗ trợ: ${SUPPORT}`);
        expect(screen.getByRole('link', { name: SUPPORT })).toHaveAttribute(
          'href',
          `mailto:${SUPPORT}`,
        );
      },
    );

    it.each(['REJECTED', 'SUSPENDED'] as const)(
      '%s + KHÔNG có địa chỉ (BE không đặt ENV) -> không có dòng liên hệ, không có link rỗng',
      (status) => {
        render(withIntl(<ShopStatusBanner status={status} reason="x" supportEmail={null} />));

        expect(screen.queryByText(/Liên hệ hỗ trợ/)).not.toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
      },
    );

    it('chờ duyệt / đã duyệt: dù BE có gửi địa chỉ cũng không hiện (cùng điều kiện với email: chỉ từ chối / khoá)', () => {
      const { container, rerender } = render(
        withIntl(<ShopStatusBanner status="PENDING" reason={null} supportEmail={SUPPORT} />),
      );
      expect(screen.queryByText(/Liên hệ hỗ trợ/)).not.toBeInTheDocument();

      rerender(
        withIntl(<ShopStatusBanner status="APPROVED" reason={null} supportEmail={SUPPORT} />),
      );
      expect(container).toBeEmptyDOMElement();
    });

    it('bản tiếng Anh dùng "Contact support", không lẫn tiếng Việt', () => {
      render(
        withIntl(<ShopStatusBanner status="SUSPENDED" reason="x" supportEmail={SUPPORT} />, 'en'),
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(`Contact support: ${SUPPORT}`);
      expect(alert).not.toHaveTextContent(/Liên hệ hỗ trợ/);
    });

    it('shop bị tạm ngừng theo tài khoản chủ shop vẫn có dòng liên hệ (email là đường khiếu nại duy nhất)', () => {
      render(
        withIntl(
          <ShopStatusBanner
            status="SUSPENDED"
            reason={SHOP_CASCADE_SUSPEND_REASON}
            supportEmail={SUPPORT}
          />,
        ),
      );

      expect(screen.getByRole('alert')).toHaveTextContent(`Liên hệ hỗ trợ: ${SUPPORT}`);
    });
  });
});
