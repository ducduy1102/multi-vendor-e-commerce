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
});
