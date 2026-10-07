import { SHOP_EDITABLE_STATUSES, shopStatusSchema } from '@ecommerce/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { SHOP_EDIT_LOCKED_HINT_ID, ShopEditLockedHint } from './ShopEditLockedHint';

describe('ShopEditLockedHint', () => {
  it('shop đang chờ duyệt: giải thích vì sao chưa sửa được và khi nào sửa được (nếu bị từ chối)', () => {
    render(withIntl(<ShopEditLockedHint status="PENDING" />));

    const hint = screen.getByText(/chờ quản trị viên xem xét/);
    expect(hint).toHaveAttribute('id', SHOP_EDIT_LOCKED_HINT_ID);
    expect(hint).toHaveTextContent(/bị từ chối, bạn sẽ sửa được và gửi duyệt lại/);
  });

  it('shop đang bị khoá: giải thích riêng, khác với shop chờ duyệt', () => {
    render(withIntl(<ShopEditLockedHint status="SUSPENDED" />));

    expect(screen.getByText(/đang bị khoá tạm thời nên chưa thể chỉnh sửa/)).toHaveAttribute(
      'id',
      SHOP_EDIT_LOCKED_HINT_ID,
    );
  });

  it.each(['REJECTED', 'APPROVED'] as const)('shop %s sửa được: không hiện gì', (status) => {
    const { container } = render(withIntl(<ShopEditLockedHint status={status} />));

    expect(container).toBeEmptyDOMElement();
  });

  // Lưới an toàn: trạng thái nào BE khoá sửa thì PHẢI có câu giải thích — thêm trạng thái khoá mới ở
  // packages/types mà quên viết câu giải thích thì test này đỏ, thay vì form khoá im lặng.
  it.each(shopStatusSchema.options.filter((status) => !SHOP_EDITABLE_STATUSES.includes(status)))(
    'trạng thái bị khoá %s luôn có câu giải thích (không khoá im lặng)',
    (status) => {
      const { container } = render(withIntl(<ShopEditLockedHint status={status} />));

      expect(container).not.toBeEmptyDOMElement();
    },
  );

  it('không lộ key i18n thô', () => {
    render(withIntl(<ShopEditLockedHint status="PENDING" />));

    expect(screen.queryByText(/^shopEditLocked/)).not.toBeInTheDocument();
  });
});
