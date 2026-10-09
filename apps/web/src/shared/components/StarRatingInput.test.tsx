import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { withIntl } from '@/shared/lib/test-i18n';

import { StarRatingInput } from './StarRatingInput';

interface HarnessProps {
  initial?: number;
  onChange?: (value: number) => void;
  onBlur?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

// Giữ giá trị trong state như react-hook-form `Controller` sẽ làm — component là controlled.
function Harness({ initial, onChange, onBlur, disabled, invalid, describedBy }: HarnessProps) {
  const [value, setValue] = useState<number | undefined>(initial);
  return (
    <>
      <StarRatingInput
        value={value}
        label="Đánh giá của bạn"
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        onBlur={onBlur}
        disabled={disabled}
        invalid={invalid}
        describedBy={describedBy}
      />
      <button type="button">Nút khác</button>
    </>
  );
}

function renderInput(props: HarnessProps = {}) {
  return render(withIntl(<Harness {...props} />));
}

function checkedValue(): string | undefined {
  return (
    screen
      .getAllByRole('radio')
      .find((radio) => (radio as HTMLInputElement).checked)
      ?.getAttribute('value') ?? undefined
  );
}

describe('StarRatingInput', () => {
  it('là nhóm radio có tên, gồm đúng 5 lựa chọn "1 sao" … "5 sao", chưa chọn gì lúc đầu', () => {
    renderInput();

    const group = screen.getByRole('radiogroup', { name: 'Đánh giá của bạn' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    ['1 sao', '2 sao', '3 sao', '4 sao', '5 sao'].forEach((name) => {
      expect(screen.getByRole('radio', { name })).not.toBeChecked();
    });
  });

  it('bấm một sao -> gọi onChange(n) đúng một lần và sao đó được chọn', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderInput({ onChange });

    await user.click(screen.getByRole('radio', { name: '4 sao' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(4);
    expect(screen.getByRole('radio', { name: '4 sao' })).toBeChecked();
  });

  it('sao từ 1 đến số đã chọn tô đặc, các sao sau để viền (data-state on/off)', () => {
    const { container } = renderInput({ initial: 3 });

    const states = [...container.querySelectorAll('svg')].map((svg) =>
      svg.getAttribute('data-state'),
    );
    expect(states).toEqual(['on', 'on', 'on', 'off', 'off']);
    expect(screen.getByRole('radio', { name: '3 sao' })).toBeChecked();
  });

  it('bàn phím: Tab vào nhóm rồi mũi tên phải/xuống chọn sao kế tiếp, trái/lên chọn sao trước', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderInput({ initial: 2, onChange });

    await user.tab();
    expect(screen.getByRole('radio', { name: '2 sao' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(3);
    expect(checkedValue()).toBe('3');

    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith(4);

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(3);

    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(checkedValue()).toBe('2');
    expect(screen.getByRole('radio', { name: '2 sao' })).toHaveFocus();
  });

  it('bàn phím: mũi tên phải ở sao cuối quay vòng về sao đầu (hành vi chuẩn của nhóm radio)', async () => {
    const user = userEvent.setup();
    renderInput({ initial: 5 });

    await user.tab();
    await user.keyboard('{ArrowRight}');

    expect(checkedValue()).toBe('1');
  });

  it('disabled: mọi radio bị khoá, bấm không gọi onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderInput({ disabled: true, onChange });

    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: '5 sao' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(checkedValue()).toBeUndefined();
  });

  it('invalid + describedBy: nhóm có aria-invalid và liên kết tới thông báo lỗi; mặc định không có hai thuộc tính này', () => {
    const { rerender } = renderInput();
    const group = screen.getByRole('radiogroup');
    expect(group).not.toHaveAttribute('aria-invalid');
    expect(group).not.toHaveAttribute('aria-describedby');

    rerender(withIntl(<Harness invalid describedBy="rating-error" />));
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-describedby', 'rating-error');
  });

  it('onBlur chỉ gọi khi focus RỜI KHỎI nhóm, không gọi khi chuyển giữa các sao trong nhóm', async () => {
    const onBlur = vi.fn();
    const user = userEvent.setup();
    renderInput({ initial: 2, onBlur });

    await user.tab();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(onBlur).not.toHaveBeenCalled();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Nút khác' })).toHaveFocus();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('vùng bấm mỗi sao tối thiểu 44×44px và có vòng focus-visible (chỉ khi dùng bàn phím)', () => {
    renderInput();

    for (const radio of screen.getAllByRole('radio')) {
      const label = radio.closest('label');
      expect(label).toHaveClass('min-h-11', 'min-w-11');
      expect(label?.className).toContain('has-[:focus-visible]:ring-3');
    }
  });

  it('các radio cùng một nhóm (chung name) để trình duyệt tự chuyển bằng mũi tên', () => {
    renderInput();

    const names = new Set(screen.getAllByRole('radio').map((radio) => radio.getAttribute('name')));
    expect(names.size).toBe(1);
    expect([...names][0]).toBeTruthy();
  });

  it('chỉ dùng màu ngữ nghĩa, không màu thô/accent', () => {
    const { container } = renderInput({ initial: 2 });

    expect(container.innerHTML).toMatch(/text-primary/);
    expect(container.innerHTML).toMatch(/text-muted-foreground/);
    expect(container.innerHTML).not.toMatch(/accent|amber|yellow|orange|#[0-9a-f]{3,6}/i);
  });

  it('tiếng Anh: nhãn từng sao có số nhiều đúng ("1 star", "2 stars")', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <StarRatingInput value={undefined} label="Your rating" onChange={() => {}} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('radiogroup', { name: 'Your rating' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '1 star' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '2 stars' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '5 stars' })).toBeInTheDocument();
  });
});
