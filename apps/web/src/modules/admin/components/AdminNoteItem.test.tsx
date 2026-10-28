import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { makeNote } from '../admin-note.fixtures';
import { AdminNoteItem } from './AdminNoteItem';

function setup(overrides = {}, locale: 'vi' | 'en' = 'vi') {
  return render(
    withIntl(
      <ul>
        <AdminNoteItem note={makeNote(overrides)} />
      </ul>,
      locale,
    ),
  );
}

describe('AdminNoteItem', () => {
  it('hiện tên Admin viết, thời điểm (thẻ <time> có dateTime) và nội dung', () => {
    setup();

    expect(screen.getByText('Quản trị viên An')).toBeInTheDocument();
    const time = screen.getByText(/2026/);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', '2026-10-28T10:30:00.000Z');
    expect(screen.getByText('Chủ shop đã gọi lại, hẹn bổ sung giấy phép.')).toBeInTheDocument();
  });

  it('Admin không còn tài khoản (authorName null) ⇒ nhãn thay thế, không để trống', () => {
    setup({ authorName: null });

    expect(screen.getByText('Quản trị viên không còn')).toBeInTheDocument();
  });

  it('bản tiếng Anh dịch nhãn thay thế, không lẫn tiếng Việt', () => {
    setup({ authorName: null }, 'en');

    expect(screen.getByText('Former administrator')).toBeInTheDocument();
    expect(screen.queryByText(/Quản trị/)).not.toBeInTheDocument();
  });

  it('nội dung nhiều dòng giữ xuống dòng và chuỗi dài không dấu cách bẻ dòng được (không làm ngăn rộng ra)', () => {
    setup({ content: `dòng 1\ndòng 2\n${'x'.repeat(1000)}` });

    const body = screen.getByText(/dòng 1/);
    expect(body).toHaveClass('whitespace-pre-wrap');
    expect(body.className).toContain('[overflow-wrap:anywhere]');
  });

  it('nội dung chứa HTML hiện nguyên dạng chữ, không chèn thẻ vào trang', () => {
    const payload = '<img src=x onerror=alert(1)> {code}';
    const { container } = setup({ content: payload });

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(payload)).toBeInTheDocument();
  });
});
