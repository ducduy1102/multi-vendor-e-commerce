import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { formatPrice } from '@/modules/product';
import { withIntl } from '@/shared/lib/test-i18n';

import type { OrderDetail } from '../types';
import { OrderDetailView } from './OrderDetailView';

// formatPrice (Intl) chèn NBSP trước "₫" còn getByText chuẩn hoá DOM nhưng không chuẩn hoá chuỗi
// tìm — chuẩn hoá phía test.
const price = (value: string) => formatPrice(value).replace(/\s/g, ' ');

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: '3f6c1e4a-9b1d-4c1e-8a55-0d2c4f5a6b7c',
    checkoutGroupId: 'group-1',
    status: 'PENDING',
    createdAt: '2026-10-01T03:30:00.000Z',
    totalAmount: '320000',
    shop: { id: 'shop-1', name: 'Shop Áo Xinh', slug: 'shop-ao-xinh', logoUrl: null },
    items: [
      {
        productName: 'Áo thun nam',
        variantLabel: 'Đỏ / M',
        sku: 'AT-D-M',
        imageUrl: null,
        quantity: 2,
        priceAtPurchase: '150000',
        productId: 'product-1',
        productSlug: 'ao-thun-nam',
        canReview: false,
        review: null,
      },
      {
        productName: 'Quần jean',
        variantLabel: null,
        sku: 'QJ-32',
        imageUrl: null,
        quantity: 1,
        priceAtPurchase: '0',
        productId: 'product-2',
        productSlug: 'quan-jean',
        canReview: false,
        review: null,
      },
    ],
    itemCount: 2,
    paymentMethod: 'COD',
    paymentStatus: 'PENDING',
    canCancel: false,
    canRequestCancel: false,
    canRequestReturn: false,
    refundRequest: null,
    refund: null,
    canConfirmReceived: false,
    canRetryPayment: false,
    recipientName: 'Nguyễn Văn A',
    recipientPhone: '0901234567',
    shippingAddressLine: '1 Lê Lợi',
    shippingWard: 'Bến Nghé',
    shippingProvince: 'TP. Hồ Chí Minh',
    subtotal: '300000',
    discountAmount: '0',
    shippingFee: '20000',
    carrier: null,
    trackingCode: null,
    buyerNote: null,
    history: [
      {
        fromStatus: null,
        toStatus: 'PENDING',
        actorType: 'BUYER',
        note: null,
        createdAt: '2026-10-01T03:30:00.000Z',
      },
    ],
    ...overrides,
  };
}

function renderView(overrides: Partial<OrderDetail> = {}, actions?: React.ReactNode) {
  return render(withIntl(<OrderDetailView order={order(overrides)} actions={actions} />));
}

const section = (name: string) => within(screen.getByRole('region', { name }));

describe('OrderDetailView — liên kết sản phẩm và dải đánh giá', () => {
  it('mỗi tên hàng là liên kết tới trang sản phẩm bằng productSlug của CHÍNH dòng đó', () => {
    renderView();

    const items = section('Sản phẩm');
    expect(items.getByRole('link', { name: 'Áo thun nam' })).toHaveAttribute(
      'href',
      '/products/ao-thun-nam',
    );
    // Dòng thứ 2 trong fixture có slug riêng — không dùng chung slug của dòng đầu.
    expect(items.getByRole('link', { name: 'Quần jean' })).toHaveAttribute(
      'href',
      '/products/quan-jean',
    );
  });

  it('renderItemFooter được gọi với TỪNG dòng hàng và kết quả hiện đúng dưới dòng đó', () => {
    const renderItemFooter = vi.fn((item: OrderDetail['items'][number]) => (
      <span>{'Hành động của ' + item.productId}</span>
    ));
    render(withIntl(<OrderDetailView order={order()} renderItemFooter={renderItemFooter} />));

    expect(renderItemFooter).toHaveBeenCalledTimes(2);
    const rows = section('Sản phẩm').getAllByRole('listitem');
    expect(within(rows[0]).getByText('Hành động của product-1')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Hành động của product-2/)).toBeInTheDocument();
  });

  it('không truyền renderItemFooter -> dòng hàng không có dải nào', () => {
    const { container } = renderView();

    expect(container.querySelector('.basis-full')).toBeNull();
  });
});

describe('OrderDetailView', () => {
  it('đầu trang: tên shop, trạng thái, mã đơn đầy đủ và ngày đặt', () => {
    renderView();

    expect(screen.getByRole('heading', { name: 'Shop Áo Xinh' })).toBeInTheDocument();
    expect(screen.getByText('Chờ xác nhận')).toBeInTheDocument();
    expect(screen.getByText('Mã đơn: 3f6c1e4a-9b1d-4c1e-8a55-0d2c4f5a6b7c')).toBeInTheDocument();
    expect(screen.getByText(/Đặt lúc .*2026/)).toBeInTheDocument();
  });

  it('liệt kê ĐỦ mọi dòng hàng (snapshot lúc đặt), kể cả dòng không có phân loại', () => {
    renderView();

    const items = section('Sản phẩm');
    expect(items.getByText('Áo thun nam')).toBeInTheDocument();
    expect(items.getByText('Đỏ / M')).toBeInTheDocument();
    expect(items.getByText('Quần jean')).toBeInTheDocument();
    expect(items.getAllByRole('listitem')).toHaveLength(2);
  });

  describe('tóm tắt tiền', () => {
    it('hiện tạm tính, phí vận chuyển và tổng cộng do BE trả (không tự cộng lại ở FE)', () => {
      // Cố ý để totalAmount KHÁC subtotal + ship: nếu FE tự cộng sẽ ra số khác.
      renderView({ subtotal: '300000', shippingFee: '20000', totalAmount: '999000' });

      const summary = section('Thanh toán');
      expect(summary.getByText('Tạm tính').nextSibling).toHaveTextContent(price('300000'));
      expect(summary.getByText('Phí vận chuyển').nextSibling).toHaveTextContent(price('20000'));
      expect(summary.getByText('Tổng cộng').nextSibling).toHaveTextContent(price('999000'));
    });

    it('không giảm giá (0) -> không hiện dòng "Giảm giá"', () => {
      renderView({ discountAmount: '0' });

      expect(section('Thanh toán').queryByText('Giảm giá')).not.toBeInTheDocument();
    });

    it('có giảm giá -> hiện dòng "Giảm giá" với dấu trừ', () => {
      renderView({ discountAmount: '30000' });

      const row = section('Thanh toán').getByText('Giảm giá').nextSibling;
      expect(row).toHaveTextContent(`-${price('30000')}`);
    });
  });

  describe('thanh toán', () => {
    it('COD chưa thu tiền: hiện "Thanh toán khi nhận hàng" + "Chưa thanh toán"', () => {
      renderView({ paymentMethod: 'COD', paymentStatus: 'PENDING' });

      const summary = section('Thanh toán');
      expect(summary.getByText('Phương thức').nextSibling).toHaveTextContent(
        'Thanh toán khi nhận hàng',
      );
      expect(summary.getByText('Trạng thái thanh toán').nextSibling).toHaveTextContent(
        'Chưa thanh toán',
      );
    });

    it('thanh toán online thành công: "VNPay" + "Đã thanh toán"', () => {
      renderView({ paymentMethod: 'VNPAY', paymentStatus: 'SUCCESS' });

      const summary = section('Thanh toán');
      expect(summary.getByText('Phương thức').nextSibling).toHaveTextContent('VNPay');
      expect(summary.getByText('Trạng thái thanh toán').nextSibling).toHaveTextContent(
        'Đã thanh toán',
      );
    });

    it('chưa có lần thanh toán nào (null) -> không hiện 2 dòng phương thức/trạng thái rỗng', () => {
      renderView({ paymentMethod: null, paymentStatus: null });

      const summary = section('Thanh toán');
      expect(summary.queryByText('Phương thức')).not.toBeInTheDocument();
      expect(summary.queryByText('Trạng thái thanh toán')).not.toBeInTheDocument();
    });
  });

  it('địa chỉ nhận hàng: tên, SĐT và địa chỉ nối đủ 3 cấp (snapshot lúc đặt)', () => {
    renderView();

    const address = section('Địa chỉ nhận hàng');
    expect(address.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(address.getByText('0901234567')).toBeInTheDocument();
    expect(address.getByText('1 Lê Lợi, Bến Nghé, TP. Hồ Chí Minh')).toBeInTheDocument();
  });

  describe('thông tin vận chuyển', () => {
    it('chưa có đơn vị/mã vận đơn (shop chưa giao hoặc tự giao) -> không hiện mục "Vận chuyển"', () => {
      renderView({ carrier: null, trackingCode: null });

      expect(screen.queryByRole('region', { name: 'Vận chuyển' })).not.toBeInTheDocument();
    });

    it('có cả đơn vị và mã vận đơn -> hiện cả hai', () => {
      renderView({ status: 'SHIPPING', carrier: 'Giao Hàng Nhanh', trackingCode: 'GHN123' });

      const shipping = section('Vận chuyển');
      expect(shipping.getByText('Đơn vị vận chuyển').nextSibling).toHaveTextContent(
        'Giao Hàng Nhanh',
      );
      expect(shipping.getByText('Mã vận đơn').nextSibling).toHaveTextContent('GHN123');
    });

    it('chỉ có mã vận đơn -> chỉ hiện dòng mã, không có dòng đơn vị rỗng', () => {
      renderView({ carrier: null, trackingCode: 'GHN123' });

      const shipping = section('Vận chuyển');
      expect(shipping.getByText('Mã vận đơn')).toBeInTheDocument();
      expect(shipping.queryByText('Đơn vị vận chuyển')).not.toBeInTheDocument();
    });

    it('mã vận đơn có HTML được hiển thị như văn bản, không chèn thẻ vào trang', () => {
      const { container } = renderView({ trackingCode: '<img src=x onerror=alert(1)>' });

      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    });
  });

  describe('lời nhắn cho shop (Week8.md 3B)', () => {
    it('có lời nhắn -> mục "Lời nhắn cho shop" hiện đúng nội dung', () => {
      renderView({ buyerNote: 'Giao giờ hành chính, gọi trước khi giao' });

      expect(
        section('Lời nhắn cho shop').getByText('Giao giờ hành chính, gọi trước khi giao'),
      ).toBeInTheDocument();
    });

    it('không có lời nhắn (null) -> KHÔNG có mục "Lời nhắn cho shop"', () => {
      renderView({ buyerNote: null });

      expect(screen.queryByRole('region', { name: 'Lời nhắn cho shop' })).not.toBeInTheDocument();
    });

    it('lời nhắn có HTML hiển thị như văn bản, không chèn thẻ vào trang', () => {
      const html = '<img src=x onerror=alert(1)> & "quote"';
      const { container } = renderView({ buyerNote: html });

      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByText(html)).toBeInTheDocument();
    });

    it('giữ các dòng người mua đã xuống (whitespace-pre-wrap) và chuỗi dài không dấu cách không tràn (break-words)', () => {
      renderView({ buyerNote: 'dòng 1\ndòng 2' });

      const note = section('Lời nhắn cho shop').getByText(/dòng 1/);
      expect(note).toHaveClass('whitespace-pre-wrap', 'break-words');
      expect(note.textContent).toBe('dòng 1\ndòng 2');
    });
  });

  it('lịch sử đơn hàng: có mục "Lịch sử đơn hàng" hiện bước mốc tạo đơn', () => {
    renderView();

    expect(
      section('Lịch sử đơn hàng').getByText('Đã đặt hàng, chờ shop xác nhận'),
    ).toBeInTheDocument();
  });

  describe('khu vực hành động (do Container truyền vào)', () => {
    it('hiện nút hành động được truyền vào', () => {
      renderView({}, <button type="button">Hành động thử</button>);

      expect(screen.getByRole('button', { name: 'Hành động thử' })).toBeInTheDocument();
    });

    it('không có hành động nào -> không có dải viền rỗng (empty:hidden)', () => {
      const { container } = renderView({}, null);

      const strip = container.querySelector('section > div.empty\\:hidden');
      expect(strip).not.toBeNull();
      expect(strip).toBeEmptyDOMElement();
    });
  });
});
