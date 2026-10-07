import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { CheckoutPreviewOrder } from '../types';
import { CheckoutOrderGroup } from './CheckoutOrderGroup';

function order(overrides: Partial<CheckoutPreviewOrder> = {}): CheckoutPreviewOrder {
  return {
    shopId: 'shop-1',
    shopName: 'Shop Áo Xinh',
    shopSlug: 'shop-ao-xinh',
    items: [
      {
        id: 'item-1',
        productVariantId: 'variant-1',
        quantity: 2,
        productId: 'product-1',
        productName: 'Áo thun',
        productSlug: 'ao-thun',
        imageUrl: null,
        attributes: [{ name: 'Size', value: 'M' }],
        unitPrice: '100000',
        lineTotal: '200000',
        stock: 10,
        isAvailable: true,
      },
    ],
    subtotal: '200000',
    shippingFee: '16500',
    discountAmount: '0',
    total: '216500',
    ...overrides,
  };
}

function renderGroup(
  orderOverrides: Partial<CheckoutPreviewOrder> = {},
  props: { note?: string; onNoteChange?: (note: string) => void } = {},
) {
  return render(
    withIntl(
      <CheckoutOrderGroup
        order={order(orderOverrides)}
        note={props.note ?? ''}
        onNoteChange={props.onNoteChange ?? (() => {})}
      />,
    ),
  );
}

describe('CheckoutOrderGroup', () => {
  it('hiện tên shop, tên sản phẩm, số lượng và thành tiền dòng hàng', () => {
    renderGroup();

    expect(screen.getByText('Shop Áo Xinh')).toBeInTheDocument();
    expect(screen.getByText('Áo thun')).toBeInTheDocument();
    expect(screen.getByText('Size: M')).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getAllByText(/200\.000/)[0]).toBeInTheDocument();
  });

  it('discountAmount = 0 -> KHÔNG hiện dòng giảm giá', () => {
    renderGroup({ discountAmount: '0' });

    expect(screen.queryByText('Giảm giá')).not.toBeInTheDocument();
  });

  it('discountAmount > 0 -> hiện dòng giảm giá', () => {
    renderGroup({ discountAmount: '20000' });

    expect(screen.getByText('Giảm giá')).toBeInTheDocument();
    expect(screen.getByText('-20.000 ₫')).toBeInTheDocument();
  });

  it('shippingFee/total null (chưa chọn địa chỉ) -> hiện gạch ngang thay vì tiền', () => {
    renderGroup({ shippingFee: null, total: null });

    const dashes = screen.getAllByText('—');
    expect(dashes).toHaveLength(2);
  });

  describe('lời nhắn cho shop (Week8.md 3B)', () => {
    it('có ô nhập gắn nhãn "Lời nhắn cho shop (không bắt buộc)", rỗng ban đầu', () => {
      renderGroup();

      const input = screen.getByLabelText('Lời nhắn cho shop (không bắt buộc)');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue('');
    });

    it('giới hạn 500 ký tự ngay ở ô nhập (maxLength)', () => {
      renderGroup();

      expect(screen.getByLabelText('Lời nhắn cho shop (không bắt buộc)')).toHaveAttribute(
        'maxlength',
        '500',
      );
    });

    it('hiện nội dung đang có và bộ đếm ký tự theo đúng độ dài', () => {
      renderGroup({}, { note: 'Gọi trước' });

      expect(screen.getByLabelText('Lời nhắn cho shop (không bắt buộc)')).toHaveValue('Gọi trước');
      expect(screen.getByText('9/500')).toBeInTheDocument();
    });

    it('bộ đếm 0/500 khi chưa nhập, và gắn vào ô nhập qua aria-describedby', () => {
      renderGroup();

      const counter = screen.getByText('0/500');
      expect(screen.getByLabelText('Lời nhắn cho shop (không bắt buộc)')).toHaveAttribute(
        'aria-describedby',
        counter.id,
      );
    });

    it('gõ chữ -> gọi onNoteChange với giá trị mới (state do Container giữ, ô là controlled)', async () => {
      const onNoteChange = vi.fn();
      renderGroup({}, { onNoteChange });

      await userEvent.type(screen.getByLabelText('Lời nhắn cho shop (không bắt buộc)'), 'a');

      expect(onNoteChange).toHaveBeenCalledWith('a');
    });

    it('2 khối shop cùng trang: mỗi ô nhập có id riêng, nhãn trỏ đúng ô của khối mình', () => {
      render(
        withIntl(
          <>
            <CheckoutOrderGroup
              order={order({ shopId: 'shop-1', shopName: 'Shop A' })}
              note="Nhắn A"
              onNoteChange={() => {}}
            />
            <CheckoutOrderGroup
              order={order({ shopId: 'shop-2', shopName: 'Shop B' })}
              note="Nhắn B"
              onNoteChange={() => {}}
            />
          </>,
        ),
      );

      const inputs = screen.getAllByLabelText('Lời nhắn cho shop (không bắt buộc)');
      expect(inputs).toHaveLength(2);
      expect(inputs[0]).toHaveValue('Nhắn A');
      expect(inputs[1]).toHaveValue('Nhắn B');
      expect(inputs[0].id).not.toBe(inputs[1].id);
    });

    it('lời nhắn có HTML hiện như văn bản trong ô nhập, không chèn thẻ vào trang', () => {
      const { container } = renderGroup({}, { note: '<img src=x onerror=alert(1)>' });

      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByLabelText('Lời nhắn cho shop (không bắt buộc)')).toHaveValue(
        '<img src=x onerror=alert(1)>',
      );
    });
  });
});
