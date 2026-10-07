import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatPrice } from '@/modules/product';

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
