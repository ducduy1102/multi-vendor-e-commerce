import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProductGridSkeleton } from './ProductGridSkeleton';

describe('ProductGridSkeleton', () => {
  it('renders exactly `count` skeleton cards', () => {
    const { container } = render(<ProductGridSkeleton count={8} />);

    expect(container.querySelectorAll('[data-slot="product-card-skeleton"]')).toHaveLength(8);
  });

  it('renders a different count when given a different `count` prop', () => {
    const { container } = render(<ProductGridSkeleton count={3} />);

    expect(container.querySelectorAll('[data-slot="product-card-skeleton"]')).toHaveLength(3);
  });

  it('is hidden from the accessibility tree (aria-hidden), thuần trang trí', () => {
    const { container } = render(<ProductGridSkeleton count={4} />);
    const grid = container.firstElementChild;

    expect(grid).toHaveAttribute('aria-hidden', 'true');
  });
});
