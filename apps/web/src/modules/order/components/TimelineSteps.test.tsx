import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TimelineSteps, type TimelineStepItem } from './TimelineSteps';

const step = (id: string, overrides: Partial<TimelineStepItem> = {}): TimelineStepItem => ({
  id,
  label: `Bước ${id}`,
  createdAt: `2026-10-0${id}T03:00:00.000Z`,
  formattedDate: `0${id}/10/2026`,
  ...overrides,
});

describe('TimelineSteps', () => {
  it('mảng rỗng -> không render gì', () => {
    const { container } = render(<TimelineSteps steps={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('giữ NGUYÊN thứ tự nơi gọi truyền (đầu mảng = mới nhất, hiện trên cùng)', () => {
    render(<TimelineSteps steps={[step('3'), step('2'), step('1')]} />);

    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => within(item).getByText(/^Bước/).textContent)).toEqual([
      'Bước 3',
      'Bước 2',
      'Bước 1',
    ]);
  });

  it('chỉ bước đầu tiên là bước hiện tại (aria-current="step", chữ đậm, chấm primary)', () => {
    render(<TimelineSteps steps={[step('2'), step('1')]} />);

    const [current, previous] = screen.getAllByRole('listitem');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(previous).not.toHaveAttribute('aria-current');
    expect(within(current).getByText('Bước 2')).toHaveClass('font-semibold');
    expect(within(previous).getByText('Bước 1')).toHaveClass('text-muted-foreground');
    expect(current.querySelector('span[aria-hidden="true"].bg-primary')).not.toBeNull();
    expect(previous.querySelector('span[aria-hidden="true"].bg-primary')).toBeNull();
  });

  it('đường nối chỉ có giữa các bước, bước cuối KHÔNG có (không thừa đường treo)', () => {
    render(<TimelineSteps steps={[step('3'), step('2'), step('1')]} />);

    const items = screen.getAllByRole('listitem');
    const connectors = items.map((item) => item.querySelector('span.w-px'));
    expect(connectors[0]).not.toBeNull();
    expect(connectors[1]).not.toBeNull();
    expect(connectors[2]).toBeNull();
  });

  it('một bước duy nhất: vừa là bước hiện tại vừa là bước cuối, không có đường nối', () => {
    render(<TimelineSteps steps={[step('1')]} />);

    const item = screen.getByRole('listitem');
    expect(item).toHaveAttribute('aria-current', 'step');
    expect(item.querySelector('span.w-px')).toBeNull();
  });

  it('<time> mang thời điểm gốc (ISO) và hiện bản đã định dạng do nơi gọi truyền', () => {
    render(<TimelineSteps steps={[step('2')]} />);

    const time = screen.getByText('02/10/2026');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-10-02T03:00:00.000Z');
  });

  it('có ghi chú -> hiện dưới ngày; không có (undefined/null/rỗng) -> không render dòng ghi chú', () => {
    const { rerender } = render(
      <TimelineSteps steps={[step('1', { note: 'Lý do của shop: Hết hàng' })]} />,
    );
    expect(screen.getByText('Lý do của shop: Hết hàng')).toBeInTheDocument();

    for (const note of [undefined, null, '']) {
      rerender(<TimelineSteps steps={[step('1', { note })]} />);
      expect(screen.getAllByRole('listitem')[0].querySelectorAll('span')).toHaveLength(
        // chấm + nhãn (đường nối không có vì chỉ 1 bước)
        2,
      );
    }
  });

  it('ghi chú là chữ người dùng nhập: giữ xuống dòng, ngắt được chuỗi dài, cột co được (min-w-0)', () => {
    render(<TimelineSteps steps={[step('1', { note: 'a'.repeat(500) })]} />);

    const note = screen.getByText('a'.repeat(500));
    expect(note).toHaveClass('break-words', 'whitespace-pre-line');
    expect(note.parentElement).toHaveClass('min-w-0');
  });

  it('key theo id (không theo chỉ số): thêm bước mới lên đầu thì node DOM của các bước cũ được GIỮ, chỉ dịch xuống', () => {
    const { rerender } = render(<TimelineSteps steps={[step('2'), step('1')]} />);
    const [previousStep2, previousStep1] = screen.getAllByRole('listitem');

    rerender(<TimelineSteps steps={[step('3'), step('2'), step('1')]} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // Nếu key là chỉ số mảng, React sẽ tái dùng node đầu cho bước mới và đổi nội dung các node còn lại.
    expect(items[1]).toBe(previousStep2);
    expect(items[2]).toBe(previousStep1);
    expect(items[0]).toHaveAttribute('aria-current', 'step');
    expect(within(items[0]).getByText('Bước 3')).toBeInTheDocument();
    expect(previousStep2).not.toHaveAttribute('aria-current');
  });
});
