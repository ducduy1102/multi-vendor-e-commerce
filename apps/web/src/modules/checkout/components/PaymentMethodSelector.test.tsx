import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { PaymentMethodAvailability } from '../types';
import { PaymentMethodSelector } from './PaymentMethodSelector';

describe('PaymentMethodSelector', () => {
  it('methods rỗng -> không render gì', () => {
    const { container } = render(
      withIntl(<PaymentMethodSelector methods={[]} selected={null} onSelect={vi.fn()} />),
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('hiện đủ phương thức, chỉ phương thức available mới bấm được', () => {
    const methods: PaymentMethodAvailability[] = [
      { method: 'VNPAY', available: true },
      { method: 'MOMO', available: false, reason: 'NOT_CONFIGURED' },
    ];
    render(
      withIntl(<PaymentMethodSelector methods={methods} selected={null} onSelect={vi.fn()} />),
    );

    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios[0].disabled).toBe(false);
    expect(radios[1].disabled).toBe(true);
    expect(screen.getByText('VNPay')).toBeInTheDocument();
    expect(screen.getByText('Momo')).toBeInTheDocument();
    expect(screen.getByText('Hiện chưa hỗ trợ phương thức này')).toBeInTheDocument();
  });

  it('selected khớp method -> radio tương ứng được chọn sẵn', () => {
    const methods: PaymentMethodAvailability[] = [
      { method: 'VNPAY', available: true },
      { method: 'MOMO', available: true },
    ];
    render(
      withIntl(<PaymentMethodSelector methods={methods} selected="MOMO" onSelect={vi.fn()} />),
    );

    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios[0].checked).toBe(false);
    expect(radios[1].checked).toBe(true);
  });

  it('bấm phương thức khả dụng -> gọi onSelect với đúng method', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const methods: PaymentMethodAvailability[] = [
      { method: 'VNPAY', available: true },
      { method: 'MOMO', available: true },
    ];
    render(
      withIntl(<PaymentMethodSelector methods={methods} selected={null} onSelect={onSelect} />),
    );

    await user.click(screen.getAllByRole('radio')[1]);

    expect(onSelect).toHaveBeenCalledWith('MOMO');
  });

  describe('COD (thanh toán khi nhận hàng)', () => {
    const online: PaymentMethodAvailability[] = [
      { method: 'VNPAY', available: true },
      { method: 'MOMO', available: false, reason: 'NOT_CONFIGURED' },
    ];

    it('COD khả dụng -> hiện nhãn "Thanh toán khi nhận hàng (COD)" và chọn được', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(
        withIntl(
          <PaymentMethodSelector
            methods={[...online, { method: 'COD', available: true }]}
            selected="VNPAY"
            onSelect={onSelect}
          />,
        ),
      );

      const cod = screen.getByRole('radio', { name: 'Thanh toán khi nhận hàng (COD)' });
      expect(cod).toBeEnabled();
      await user.click(cod);

      expect(onSelect).toHaveBeenCalledWith('COD');
    });

    it('COD vượt trần số tiền (BE trả AMOUNT_TOO_LARGE) -> bị khoá kèm lý do, FE không tự suy ra', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(
        withIntl(
          <PaymentMethodSelector
            methods={[
              { method: 'VNPAY', available: true },
              { method: 'COD', available: false, reason: 'AMOUNT_TOO_LARGE' },
            ]}
            selected="VNPAY"
            onSelect={onSelect}
          />,
        ),
      );

      // Dòng lý do nằm trong cùng <label> nên là một phần của tên truy cập — trình đọc màn hình đọc
      // luôn cả lý do vì sao ô này bị khoá.
      const cod = screen.getByRole('radio', {
        name: 'Thanh toán khi nhận hàng (COD) Số tiền đơn hàng quá lớn để dùng phương thức này',
      });
      expect(cod).toBeDisabled();
      expect(
        screen.getByText('Số tiền đơn hàng quá lớn để dùng phương thức này'),
      ).toBeInTheDocument();
      await user.click(cod);

      expect(onSelect).not.toHaveBeenCalled();
    });

    it('COD không khả dụng và không kèm lý do -> vẫn bị khoá, không hiện dòng lý do rỗng', () => {
      render(
        withIntl(
          <PaymentMethodSelector
            methods={[{ method: 'COD', available: false }]}
            selected={null}
            onSelect={vi.fn()}
          />,
        ),
      );

      expect(screen.getByRole('radio')).toBeDisabled();
      expect(screen.queryByText(/Số tiền|Hiện chưa hỗ trợ/)).not.toBeInTheDocument();
    });

    it.each(['VNPAY', 'COD', null] as const)(
      'COD chọn được -> luôn có ghi chú ngay dưới dòng COD (đang chọn: %s), gắn vào chính ô COD',
      (selected) => {
        render(
          withIntl(
            <PaymentMethodSelector
              methods={[...online, { method: 'COD', available: true }]}
              selected={selected}
              onSelect={vi.fn()}
            />,
          ),
        );

        const hint = screen.getByText('Trả tiền cho nhân viên giao hàng khi nhận hàng.');
        const cod = screen.getByRole('radio', { name: 'Thanh toán khi nhận hàng (COD)' });
        expect(cod).toHaveAccessibleDescription(hint.textContent ?? '');
        // Nằm trong cùng khung với dòng COD (không phải ở cuối nhóm) và đứng SAU dòng đó.
        expect(cod.closest('label')?.parentElement).toContainElement(hint);
        expect(cod.closest('label')?.nextElementSibling).toBe(hint);
        // Các phương thức khác không có ghi chú.
        expect(screen.getByRole('radio', { name: 'VNPay' })).not.toHaveAttribute(
          'aria-describedby',
        );
      },
    );

    it('ghi chú không nói "tiền mặt" (có thể chuyển khoản/quét mã cho nhân viên giao hàng)', () => {
      render(
        withIntl(
          <PaymentMethodSelector
            methods={[{ method: 'COD', available: true }]}
            selected="COD"
            onSelect={vi.fn()}
          />,
        ),
      );

      expect(screen.queryByText(/tiền mặt/i)).not.toBeInTheDocument();
    });

    it('COD bị khoá -> KHÔNG có ghi chú (đã có lý do bên phải), ô COD không trỏ tới ghi chú nào', () => {
      render(
        withIntl(
          <PaymentMethodSelector
            methods={[{ method: 'COD', available: false, reason: 'AMOUNT_TOO_LARGE' }]}
            selected={null}
            onSelect={vi.fn()}
          />,
        ),
      );

      expect(screen.queryByText('Trả tiền cho nhân viên giao hàng khi nhận hàng.')).toBeNull();
      expect(screen.getByRole('radio')).not.toHaveAttribute('aria-describedby');
    });

    it('không có COD trong danh sách -> không có ghi chú nào', () => {
      render(
        withIntl(<PaymentMethodSelector methods={online} selected="VNPAY" onSelect={vi.fn()} />),
      );

      expect(screen.queryByText(/nhân viên giao hàng/)).not.toBeInTheDocument();
    });

    it.each(['NOT_CONFIGURED', 'AMOUNT_TOO_SMALL', 'AMOUNT_TOO_LARGE'] as const)(
      'lý do %s của COD có bản dịch (không lộ key thô)',
      (reason) => {
        render(
          withIntl(
            <PaymentMethodSelector
              methods={[{ method: 'COD', available: false, reason }]}
              selected={null}
              onSelect={vi.fn()}
            />,
          ),
        );

        expect(document.body.textContent).not.toMatch(/paymentMethodReason|checkout\./);
      },
    );
  });
});
