import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatAvatar } from './ChatAvatar';

describe('ChatAvatar', () => {
  it('không có logo ⇒ chữ cái đầu của tên, trang trí (aria-hidden)', () => {
    const { container } = render(<ChatAvatar name="Nguyễn Văn An" />);

    const avatar = container.firstElementChild;
    expect(avatar).toHaveTextContent('NA');
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('img')).toBeNull();
  });

  it('logo https ⇒ ảnh trang trí, không gửi referrer', () => {
    const { container } = render(
      <ChatAvatar name="Shop Áo" logoUrl="https://cdn.example.org/logo.png" />,
    );

    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://cdn.example.org/logo.png');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it.each([
    ['http (nội dung hỗn hợp)', 'http://cdn.example.org/logo.png'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
  ])('logo %s bị loại ⇒ chữ cái đầu', (_label, url) => {
    const { container } = render(<ChatAvatar name="Shop Áo" logoUrl={url} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('SÁ');
  });

  it('ảnh lỗi sau khi tải ⇒ rơi về chữ cái đầu, không để icon ảnh vỡ', () => {
    const { container } = render(
      <ChatAvatar name="Shop Áo" logoUrl="https://cdn.example.org/broken.png" />,
    );

    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('SÁ');
  });
});
