import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { makeOwnerAppeal } from '../appeal.fixtures';
import { AppealCard } from './AppealCard';

afterEach(() => {
  cleanup();
});

function renderCard(
  appeal = makeOwnerAppeal(),
  locale: 'vi' | 'en' = 'vi',
  kind?: 'shop' | 'product',
) {
  return render(
    withIntl(
      <ul>
        <AppealCard appeal={appeal} kind={kind} />
      </ul>,
      locale,
    ),
  );
}

describe('AppealCard — câu "đã kết thúc" theo loại đối tượng', () => {
  it('kháng nghị shop (mặc định): "Lần khoá này đã kết thúc."', () => {
    renderCard(makeOwnerAppeal({ state: 'CLOSED' }));

    expect(screen.getByText('Lần khoá này đã kết thúc.')).toBeInTheDocument();
  });

  it('kháng nghị sản phẩm: "Lần gỡ này đã kết thúc." (không nhắc khoá)', () => {
    renderCard(makeOwnerAppeal({ state: 'CLOSED' }), 'vi', 'product');

    expect(screen.getByText('Lần gỡ này đã kết thúc.')).toBeInTheDocument();
    expect(screen.queryByText(/khoá/)).not.toBeInTheDocument();
  });

  it('kháng nghị sản phẩm còn chờ / đã có kết quả: không có câu "đã kết thúc"', () => {
    renderCard(makeOwnerAppeal(), 'vi', 'product');

    expect(screen.queryByText(/đã kết thúc/)).not.toBeInTheDocument();
  });
});

describe('AppealCard', () => {
  it('đang chờ: huy hiệu "Đang chờ Admin xem xét", lời đã gửi, giờ gửi — chưa có phản hồi', () => {
    renderCard();

    expect(screen.getByText('Đang chờ Admin xem xét')).toBeInTheDocument();
    expect(
      screen.getByText('Shop đã gỡ các sản phẩm bị báo cáo và bổ sung giấy tờ.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Gửi lúc /)).toBeInTheDocument();
    expect(screen.queryByText('Phản hồi từ sàn')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Phản hồi lúc /)).not.toBeInTheDocument();
  });

  it('bị từ chối: hiện phản hồi từ sàn + giờ phản hồi, KHÔNG nhắc Admin nào quyết định', () => {
    renderCard(
      makeOwnerAppeal({
        state: 'REJECTED',
        decisionNote: 'Giấy tờ chưa hợp lệ.',
        decidedAt: '2026-10-29T09:00:00.000Z',
      }),
    );

    expect(screen.getByText('Bị từ chối')).toBeInTheDocument();
    expect(screen.getByText('Phản hồi từ sàn')).toBeInTheDocument();
    expect(screen.getByText('Giấy tờ chưa hợp lệ.')).toBeInTheDocument();
    expect(screen.getByText(/^Phản hồi lúc /)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/Admin(?! xem xét)|Quản trị/);
  });

  it('được chấp nhận: huy hiệu "Được chấp nhận"; ghi chú tuỳ chọn nên có thể vắng', () => {
    renderCard(makeOwnerAppeal({ state: 'ACCEPTED', decidedAt: '2026-10-29T09:00:00.000Z' }));

    expect(screen.getByText('Được chấp nhận')).toBeInTheDocument();
    expect(screen.queryByText('Phản hồi từ sàn')).not.toBeInTheDocument();
  });

  it('đã đóng (lần khoá kết thúc): huy hiệu "Đã đóng" kèm lời giải thích', () => {
    renderCard(makeOwnerAppeal({ state: 'CLOSED' }));

    expect(screen.getByText('Đã đóng')).toBeInTheDocument();
    expect(screen.getByText('Lần khoá này đã kết thúc.')).toBeInTheDocument();
  });

  it('văn bản người dùng nhập hiện dạng text (không thành HTML) và bẻ chuỗi dài không dấu cách', () => {
    const hostile = '<img src=x onerror=alert(1)>' + 'a'.repeat(200);
    renderCard(makeOwnerAppeal({ message: hostile, state: 'REJECTED', decisionNote: hostile }));

    expect(document.querySelector('img')).toBeNull();
    const paragraphs = screen.getAllByText(hostile);
    expect(paragraphs).toHaveLength(2);
    for (const paragraph of paragraphs) {
      expect(paragraph).toHaveClass('[overflow-wrap:anywhere]');
      expect(paragraph).toHaveClass('whitespace-pre-line');
    }
  });

  it('bản tiếng Anh không lẫn chuỗi tiếng Việt do mẫu dịch', () => {
    renderCard(
      makeOwnerAppeal({
        state: 'REJECTED',
        message: 'We removed the items.',
        decisionNote: 'Documents are not valid.',
        decidedAt: '2026-10-29T09:00:00.000Z',
      }),
      'en',
    );

    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Reply from the marketplace')).toBeInTheDocument();
    const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    expect(document.body.textContent ?? '').not.toMatch(vietnamese);
  });
});
