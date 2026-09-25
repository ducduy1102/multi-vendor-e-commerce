import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { QuantityStepper } from './QuantityStepper';

function renderStepper(props: Partial<React.ComponentProps<typeof QuantityStepper>> = {}) {
  const onChange = vi.fn();
  render(withIntl(<QuantityStepper value={3} max={5} onChange={onChange} {...props} />));
  return { onChange };
}

const DECREASE = 'Giảm số lượng';
const INCREASE = 'Tăng số lượng';

describe('QuantityStepper', () => {
  it('hiện số lượng hiện tại trong nhóm có nhãn "Số lượng"', () => {
    renderStepper({ value: 4 });

    expect(screen.getByRole('group', { name: 'Số lượng' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('4');
  });

  it('bấm + / - gọi onChange với giá trị mới (±1)', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStepper({ value: 3, max: 5 });

    await user.click(screen.getByRole('button', { name: INCREASE }));
    await user.click(screen.getByRole('button', { name: DECREASE }));

    expect(onChange).toHaveBeenNthCalledWith(1, 4);
    expect(onChange).toHaveBeenNthCalledWith(2, 2);
  });

  it('chạm tối thiểu (mặc định 1) -> khoá nút giảm, KHÔNG gọi onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStepper({ value: 1 });

    const decrease = screen.getByRole('button', { name: DECREASE });
    expect(decrease).toBeDisabled();
    await user.click(decrease);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: INCREASE })).toBeEnabled();
  });

  it('chạm tối đa (tồn kho) -> khoá nút tăng', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStepper({ value: 5, max: 5 });

    const increase = screen.getByRole('button', { name: INCREASE });
    expect(increase).toBeDisabled();
    await user.click(increase);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: DECREASE })).toBeEnabled();
  });

  it('giá trị vượt tối đa (giỏ lỡ vượt kho) -> tăng bị khoá nhưng vẫn giảm được', () => {
    renderStepper({ value: 16, max: 15 });

    expect(screen.getByRole('button', { name: INCREASE })).toBeDisabled();
    expect(screen.getByRole('button', { name: DECREASE })).toBeEnabled();
  });

  it('min tuỳ chỉnh được tôn trọng', () => {
    renderStepper({ value: 2, min: 2 });

    expect(screen.getByRole('button', { name: DECREASE })).toBeDisabled();
  });

  it('disabled -> khoá cả 2 nút dù còn trong khoảng cho phép', () => {
    renderStepper({ value: 3, max: 5, disabled: true });

    expect(screen.getByRole('button', { name: DECREASE })).toBeDisabled();
    expect(screen.getByRole('button', { name: INCREASE })).toBeDisabled();
  });

  it('cả 2 nút là type="button" — không vô tình submit form chứa nó', () => {
    renderStepper();

    expect(screen.getByRole('button', { name: DECREASE })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: INCREASE })).toHaveAttribute('type', 'button');
  });
});
