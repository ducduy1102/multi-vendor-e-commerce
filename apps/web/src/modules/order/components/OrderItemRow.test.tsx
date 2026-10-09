import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatPrice } from '@/modules/product';
import { withIntl } from '@/shared/lib/test-i18n';

import { OrderItemRow } from './OrderItemRow';

type Item = Parameters<typeof OrderItemRow>[0]['item'];

const ITEM: Item = {
  productName: 'Áo thun nam',
  variantLabel: 'Đỏ / M',
  sku: 'AT-D-M',
  imageUrl: null,
  quantity: 3,
  priceAtPurchase: '150000',
};

// formatPrice (Intl) chèn NBSP trước "₫" còn getByText chuẩn hoá DOM nhưng không chuẩn hoá chuỗi
// tìm — chuẩn hoá phía test.
const price = (value: string) => formatPrice(value).replace(/\s/g, ' ');

function renderRow(item: Item) {
  return render(
    <ul>
      <OrderItemRow item={item} />
    </ul>,
  );
}

describe('OrderItemRow', () => {
  it('hiện tên, phân loại, đơn giá lúc đặt và số lượng', () => {
    renderRow(ITEM);

    expect(screen.getByText('Áo thun nam')).toBeInTheDocument();
    expect(screen.getByText('Đỏ / M')).toBeInTheDocument();
    expect(screen.getByText(price('150000'))).toBeInTheDocument();
    expect(screen.getByText('×3')).toBeInTheDocument();
  });

  it('không có phân loại (null) -> không hiện dòng phân loại rỗng', () => {
    renderRow({ ...ITEM, variantLabel: null });

    expect(screen.getByText('Áo thun nam')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('thiếu ảnh -> hiện biểu tượng thay thế ẩn với trình đọc màn hình, không có thẻ img', () => {
    const { container } = renderRow(ITEM);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('OrderItemRow — liên kết sản phẩm và dải hành động', () => {
  function renderWith(props: Partial<Parameters<typeof OrderItemRow>[0]>) {
    return render(
      withIntl(
        <ul>
          <OrderItemRow item={ITEM} {...props} />
        </ul>,
      ),
    );
  }

  it('có productSlug -> tên hàng là liên kết tới trang sản phẩm', () => {
    renderWith({ productSlug: 'ao-thun-nam' });

    const link = screen.getByRole('link', { name: 'Áo thun nam' });
    expect(link).toHaveAttribute('href', '/products/ao-thun-nam');
  });

  it('không có productSlug (danh sách đơn, phía Seller) -> tên hàng là chữ thường, không có liên kết', () => {
    renderWith({});

    expect(screen.getByText('Áo thun nam')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('có footer -> hiện dưới dòng, chiếm cả hàng (basis-full) và thụt thẳng với tên hàng; dòng bọc xuống hàng', () => {
    renderWith({ footer: <button type="button">Viết đánh giá</button> });

    const button = screen.getByRole('button', { name: 'Viết đánh giá' });
    const footer = button.parentElement;
    expect(footer).toHaveClass('basis-full', 'pl-[3.75rem]');
    expect(screen.getByRole('listitem')).toHaveClass('flex-wrap');
  });

  it('không có footer -> không có dải và dòng giữ nguyên bố cục cũ (không flex-wrap)', () => {
    const { container } = renderWith({});

    expect(screen.getByRole('listitem')).not.toHaveClass('flex-wrap');
    expect(container.querySelector('.basis-full')).toBeNull();
  });

  it('footer render ra null (không đủ điều kiện đánh giá) -> dải rỗng bị ẩn (empty:hidden), không chiếm chỗ', () => {
    function Nothing() {
      return null;
    }
    const { container } = renderWith({ footer: <Nothing /> });

    const strip = container.querySelector('.basis-full');
    expect(strip).toBeEmptyDOMElement();
    expect(strip).toHaveClass('empty:hidden');
  });
});
