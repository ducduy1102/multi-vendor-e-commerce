import { act, render, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { useIsHydrated } from './useIsHydrated';

function Probe() {
  return <p data-testid="probe">{useIsHydrated() ? 'hydrated' : 'not-hydrated'}</p>;
}

describe('useIsHydrated', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('render phía server: false (HTML từ server luôn ở trạng thái chưa hydrate)', () => {
    expect(renderToString(<Probe />)).toContain('not-hydrated');
  });

  it('render phía client thông thường: true', () => {
    render(<Probe />);

    expect(screen.getByTestId('probe')).toHaveTextContent('hydrated');
    expect(screen.getByTestId('probe')).not.toHaveTextContent('not-hydrated');
  });

  // Đúng đường đi thật: HTML do server sinh ra trước, rồi React hydrate lên nó. Trước hydrate HTML ở
  // trạng thái chưa sẵn sàng; sau hydrate thì chuyển sang true mà không lệch HTML (không cảnh báo hydration).
  it('hydrate lên HTML của server: bắt đầu false rồi chuyển true sau khi hydrate xong', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<Probe />);
    document.body.appendChild(container);
    expect(container.textContent).toBe('not-hydrated');

    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <Probe />);
    });

    expect(container.textContent).toBe('hydrated');
    act(() => root.unmount());
  });
});
