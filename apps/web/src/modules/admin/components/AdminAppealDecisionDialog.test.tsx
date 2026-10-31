import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminAppealActionTarget } from '../hooks/useAdminAppealActionFlow';
import { AdminAppealDecisionDialog } from './AdminAppealDecisionDialog';

afterEach(() => {
  cleanup();
});

const APPEAL: AdminAppealActionTarget = {
  id: 'appeal-1',
  targetType: 'SHOP',
  targetName: 'Shop ABC',
  moderationReason: 'Bán hàng giả',
  message: 'Shop đã gỡ các sản phẩm bị báo cáo.',
};

// Kháng nghị của SẢN PHẨM bị gỡ (Week11.md 5.8): cùng hộp thoại, lời văn khác.
const PRODUCT_APPEAL: AdminAppealActionTarget = {
  id: 'appeal-2',
  targetType: 'PRODUCT',
  targetName: 'Dao bấm tự động',
  moderationReason: 'Hàng cấm theo quy định của sàn.',
  message: 'Sản phẩm đã bổ sung giấy tờ nguồn gốc.',
};

function setup(
  variant: 'accept' | 'reject',
  props: Partial<React.ComponentProps<typeof AdminAppealDecisionDialog>> = {},
  locale: 'vi' | 'en' = 'vi',
) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    withIntl(
      <AdminAppealDecisionDialog
        open
        onOpenChange={onOpenChange}
        variant={variant}
        appeal={APPEAL}
        isPending={false}
        onConfirm={onConfirm}
        {...props}
      />,
      locale,
    ),
  );
  return { onConfirm, onOpenChange };
}

describe('AdminAppealDecisionDialog — nội dung để quyết định', () => {
  it('hiện ĐỦ lời kháng nghị và lý do đã khoá shop trong một vùng cuộn được, focus được bằng bàn phím', () => {
    const longMessage = 'Lời kháng nghị rất dài. '.repeat(40).trim();
    setup('accept', { appeal: { ...APPEAL, message: longMessage } });

    const region = screen.getByRole('region', { name: 'Lời kháng nghị' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveClass('overflow-y-auto');
    expect(region).toHaveTextContent('Bán hàng giả');
    // Bản ĐẦY ĐỦ, không bị cắt như ở bảng (line-clamp).
    expect(screen.getByText(longMessage)).toBeInTheDocument();
    expect(screen.getByText(longMessage)).not.toHaveClass('line-clamp-3');
  });

  it('lời kháng nghị đứng TRƯỚC lý do khoá: ca xấu nhất (cả hai đều dài) không che mất lời kháng nghị khi chưa cuộn', () => {
    setup('accept');

    const text = screen.getByRole('region', { name: 'Lời kháng nghị' }).textContent ?? '';
    const messageAt = text.indexOf(APPEAL.message);
    const reasonAt = text.indexOf(APPEAL.moderationReason ?? '');
    expect(messageAt).toBeGreaterThanOrEqual(0);
    expect(reasonAt).toBeGreaterThan(messageAt);
  });

  it('không vẽ mục lý do khoá khi shop không có lý do (null)', () => {
    setup('accept', { appeal: { ...APPEAL, moderationReason: null } });

    expect(screen.queryByText('Lý do khoá shop')).not.toBeInTheDocument();
  });

  it('văn bản người dùng nhập hiện dạng text, bẻ chuỗi dài không dấu cách', () => {
    const hostile = `<img src=x onerror=alert(1)>${'a'.repeat(300)}`;
    setup('reject', { appeal: { ...APPEAL, message: hostile } });

    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(hostile)).toHaveClass('[overflow-wrap:anywhere]');
  });
});

describe('AdminAppealDecisionDialog — chấp nhận', () => {
  it('nói rõ hệ quả: shop được mở khoá ngay, chủ shop nhận email và thông báo', () => {
    setup('accept');

    expect(screen.getByRole('heading', { name: 'Chấp nhận kháng nghị' })).toBeInTheDocument();
    expect(screen.getByText(/“Shop ABC” sẽ được mở khoá ngay/)).toBeInTheDocument();
    expect(screen.getByLabelText('Ghi chú cho chủ shop (không bắt buộc)')).toBeInTheDocument();
  });

  it('bỏ trống ghi chú vẫn xác nhận được: onConfirm(undefined)', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup('accept');

    await user.click(screen.getByRole('button', { name: 'Chấp nhận và mở khoá' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(undefined));
  });

  it('ghi chú chỉ toàn khoảng trắng cũng coi là chưa nhập', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup('accept');

    await user.type(screen.getByLabelText('Ghi chú cho chủ shop (không bắt buộc)'), '   ');
    await user.click(screen.getByRole('button', { name: 'Chấp nhận và mở khoá' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(undefined));
  });

  it('có ghi chú thì gửi bản đã làm sạch (cắt khoảng trắng hai đầu)', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup('accept');

    await user.type(
      screen.getByLabelText('Ghi chú cho chủ shop (không bắt buộc)'),
      '  Đã đủ giấy tờ ',
    );
    await user.click(screen.getByRole('button', { name: 'Chấp nhận và mở khoá' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Đã đủ giấy tờ'));
  });

  it('nút xác nhận là nút chính (không mang màu cảnh báo)', () => {
    setup('accept');

    expect(screen.getByRole('button', { name: 'Chấp nhận và mở khoá' }).className).not.toContain(
      'bg-destructive',
    );
  });
});

describe('AdminAppealDecisionDialog — từ chối', () => {
  it('nói rõ hệ quả: shop vẫn bị khoá, không kháng nghị lại được, chủ shop đọc được lý do', () => {
    setup('reject');

    expect(screen.getByRole('heading', { name: 'Từ chối kháng nghị' })).toBeInTheDocument();
    expect(
      screen.getByText(/“Shop ABC” vẫn bị khoá và không thể kháng nghị lại/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Lý do từ chối')).toBeInTheDocument();
  });

  it('BẮT BUỘC có lý do: bỏ trống hoặc chỉ khoảng trắng ⇒ báo lỗi ngay dưới ô nhập và KHÔNG xác nhận', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup('reject');

    await user.click(screen.getByRole('button', { name: 'Từ chối kháng nghị' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do từ chối.');

    await user.type(screen.getByLabelText('Lý do từ chối'), '   ');
    await user.click(screen.getByRole('button', { name: 'Từ chối kháng nghị' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Vui lòng nhập lý do từ chối.'),
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('có lý do thì xác nhận với đúng lý do', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup('reject');

    await user.type(screen.getByLabelText('Lý do từ chối'), 'Giấy tờ chưa hợp lệ');
    await user.click(screen.getByRole('button', { name: 'Từ chối kháng nghị' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Giấy tờ chưa hợp lệ'));
  });

  it('nút xác nhận mang màu cảnh báo đặc (cùng hộp thoại huỷ bỏ khác của khu Admin), cả sáng lẫn tối', () => {
    setup('reject');

    const confirm = screen.getByRole('button', { name: 'Từ chối kháng nghị' });
    expect(confirm).toHaveClass('bg-destructive', 'text-background');
    // Cặp `dark:` BẮT BUỘC: thiếu nó twMerge giữ nền `dark:bg-destructive/20` của variant và chữ trắng mất tương phản.
    expect(confirm).toHaveClass('dark:bg-destructive');
  });
});

describe('AdminAppealDecisionDialog — ghi chú và trạng thái', () => {
  it('quá 500 ký tự: báo lỗi "tối đa 500 ký tự" và KHÔNG xác nhận; bộ đếm chuyển màu cảnh báo', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup('reject');

    expect(screen.getByText('0/500')).toHaveClass('text-muted-foreground');
    await user.click(screen.getByLabelText('Lý do từ chối'));
    await user.paste('a'.repeat(501));
    expect(screen.getByText('501/500')).toHaveClass('text-destructive');
    await user.click(screen.getByRole('button', { name: 'Từ chối kháng nghị' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('tối đa 500 ký tự');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('đang gửi: khoá ô ghi chú, nút xác nhận và nút quay lại', () => {
    setup('accept', { isPending: true });

    expect(screen.getByLabelText('Ghi chú cho chủ shop (không bắt buộc)')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Chấp nhận và mở khoá' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
  });

  it('đóng (open=false) ⇒ không vẽ gì', () => {
    setup('accept', { open: false });

    expect(screen.queryByRole('heading', { name: 'Chấp nhận kháng nghị' })).not.toBeInTheDocument();
  });

  it('nút Quay lại báo onOpenChange(false)', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = setup('accept');

    await user.click(screen.getByRole('button', { name: 'Quay lại' }));

    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});

describe('AdminAppealDecisionDialog — kháng nghị sản phẩm bị gỡ', () => {
  it('chấp nhận: nói rõ sản phẩm được KHÔI PHỤC VỀ NHÁP (chưa công khai), không nói "mở khoá shop"', () => {
    setup('accept', { appeal: PRODUCT_APPEAL });

    expect(screen.getByRole('heading', { name: 'Chấp nhận kháng nghị' })).toBeInTheDocument();
    expect(screen.getByText(/“Dao bấm tự động” sẽ được khôi phục về bản nháp/)).toBeInTheDocument();
    expect(screen.queryByText(/mở khoá ngay/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chấp nhận và khôi phục' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chấp nhận và mở khoá' })).not.toBeInTheDocument();
  });

  it('từ chối: nói rõ sản phẩm VẪN bị gỡ và không kháng nghị lại được lần gỡ này', () => {
    setup('reject', { appeal: PRODUCT_APPEAL });

    expect(
      screen.getByText(/“Dao bấm tự động” vẫn bị gỡ và không thể kháng nghị lại lần gỡ này/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/vẫn bị khoá/)).not.toBeInTheDocument();
  });

  it('hiện ĐỦ lời kháng nghị và lý do GỠ sản phẩm (nhãn "Lý do gỡ sản phẩm", không phải "Lý do khoá shop")', () => {
    setup('accept', { appeal: PRODUCT_APPEAL });

    const region = screen.getByRole('region', { name: 'Lời kháng nghị' });
    expect(region).toHaveTextContent('Sản phẩm đã bổ sung giấy tờ nguồn gốc.');
    expect(region).toHaveTextContent('Lý do gỡ sản phẩm');
    expect(region).toHaveTextContent('Hàng cấm theo quy định của sàn.');
    expect(region).not.toHaveTextContent('Lý do khoá shop');
  });

  it('chấp nhận bỏ trống ghi chú vẫn xác nhận được; từ chối vẫn BẮT BUỘC có lý do', async () => {
    const user = userEvent.setup();
    const accept = setup('accept', { appeal: PRODUCT_APPEAL });
    await user.click(screen.getByRole('button', { name: 'Chấp nhận và khôi phục' }));
    await waitFor(() => expect(accept.onConfirm).toHaveBeenCalledWith(undefined));
    cleanup();

    const reject = setup('reject', { appeal: PRODUCT_APPEAL });
    await user.click(screen.getByRole('button', { name: 'Từ chối kháng nghị' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do từ chối.');
    expect(reject.onConfirm).not.toHaveBeenCalled();
  });

  it('tiếng Anh: không lẫn chuỗi tiếng Việt do mẫu dịch', () => {
    setup(
      'accept',
      {
        appeal: {
          ...PRODUCT_APPEAL,
          message: 'We added proof of origin.',
          moderationReason: 'Prohibited goods.',
        },
      },
      'en',
    );

    expect(screen.getByText(/“Dao bấm tự động” will be restored to a draft/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept and restore' })).toBeInTheDocument();
    expect(screen.getByRole('region')).toHaveTextContent('Take-down reason');
    // Tên sản phẩm là chữ người dùng nhập (giữ nguyên); phần còn lại không được lẫn tiếng Việt.
    const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    const text = (document.body.textContent ?? '').replace('Dao bấm tự động', '');
    expect(text).not.toMatch(vietnamese);
  });
});

describe('AdminAppealDecisionDialog — tiếng Anh', () => {
  it('không lẫn chuỗi tiếng Việt do mẫu dịch (chỉ chữ người dùng nhập được giữ nguyên)', async () => {
    const user = userEvent.setup();
    setup(
      'reject',
      {
        appeal: {
          ...APPEAL,
          message: 'We removed the items.',
          moderationReason: 'Counterfeit goods',
        },
      },
      'en',
    );

    expect(screen.getByRole('heading', { name: 'Reject appeal' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reject appeal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a reason for rejecting.',
    );

    const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    expect(document.body.textContent ?? '').not.toMatch(vietnamese);
  });
});
