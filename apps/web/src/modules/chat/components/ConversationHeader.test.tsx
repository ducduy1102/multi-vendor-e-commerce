import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ConversationHeader } from './ConversationHeader';

function setup(props: Partial<{ name: string; logoUrl: string | null; isReadOnly: boolean }> = {}) {
  const onBack = vi.fn();
  const utils = render(
    withIntl(
      <ConversationHeader
        name={props.name ?? 'Shop Áo Xinh'}
        logoUrl={props.logoUrl ?? null}
        isReadOnly={props.isReadOnly ?? false}
        onBack={onBack}
      />,
    ),
  );
  return { ...utils, onBack };
}

describe('ConversationHeader', () => {
  it('tên đối phương là heading cấp 2', () => {
    setup();

    expect(screen.getByRole('heading', { level: 2, name: 'Shop Áo Xinh' })).toBeInTheDocument();
  });

  it('nút quay lại có nhãn, gọi onBack, và chỉ hiện dưới md (từ md hai cột nên không cần)', async () => {
    const user = userEvent.setup();
    const { onBack } = setup();

    const back = screen.getByRole('button', { name: 'Quay lại danh sách' });
    expect(back).toHaveClass('md:hidden');
    await user.click(back);

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('chỉ đọc: hiện nhãn "Chỉ đọc"; không chỉ đọc thì không có', () => {
    const readOnly = setup({ isReadOnly: true });
    expect(screen.getByText('Chỉ đọc')).toBeInTheDocument();
    readOnly.unmount();

    setup({ isReadOnly: false });
    expect(screen.queryByText('Chỉ đọc')).not.toBeInTheDocument();
  });

  it('tên rất dài bị cắt trong cột co được (min-w-0 flex-1 truncate), không đẩy rộng khung', () => {
    setup({ name: 'W'.repeat(300) });

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveClass('min-w-0', 'flex-1', 'truncate');
  });

  it('dùng flex (không lưới): nút quay lại bị display:none từ md không làm xếp lại cột', () => {
    const { container } = setup();

    expect(container.firstElementChild).toHaveClass('flex');
    expect(container.firstElementChild).not.toHaveClass('grid');
  });

  it('có logo https thì hiện ảnh, không có thì chữ cái đầu', () => {
    const withLogo = setup({ logoUrl: 'https://cdn.example.org/logo.png' });
    expect(withLogo.container.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.org/logo.png',
    );
    withLogo.unmount();

    const withoutLogo = setup({ name: 'Shop Áo Xinh' });
    expect(withoutLogo.container.querySelector('img')).toBeNull();
    expect(withoutLogo.container).toHaveTextContent('SX');
  });
});
