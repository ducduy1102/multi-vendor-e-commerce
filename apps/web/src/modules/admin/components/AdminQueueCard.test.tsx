import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ADMIN_OVERVIEW_QUEUES } from '../admin-overview-display';
import { AdminQueueCard } from './AdminQueueCard';

const [disputes, , , shops] = ADMIN_OVERVIEW_QUEUES;

describe('AdminQueueCard', () => {
  it('có việc -> cả thẻ là MỘT link tới hàng chờ đã lọc sẵn; có tiêu đề, số, mô tả và lối "Xem hàng chờ"', () => {
    render(withIntl(<AdminQueueCard definition={disputes} count={2} />));

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/admin/refunds');
    expect(screen.getByRole('heading', { name: 'Khiếu nại đã lên sàn' })).toBeInTheDocument();
    expect(link).toHaveTextContent('2');
    expect(link).toHaveTextContent('Người mua khiếu nại sau khi shop từ chối');
    expect(link).toHaveTextContent('Xem hàng chờ');
  });

  it('thẻ shop trỏ /admin/shops', () => {
    render(withIntl(<AdminQueueCard definition={shops} count={128} />));

    expect(screen.getByRole('link')).toHaveAttribute('href', '/admin/shops');
    expect(screen.getByRole('link')).toHaveTextContent('128');
  });

  it('0 việc -> thẻ tĩnh, KHÔNG link (không dẫn tới danh sách rỗng), số mờ và câu "Không có việc chờ"', () => {
    render(withIntl(<AdminQueueCard definition={disputes} count={0} />));

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Khiếu nại đã lên sàn' })).toBeInTheDocument();
    expect(screen.getByText('0')).toHaveClass('text-muted-foreground');
    expect(screen.getByText('Không có việc chờ')).toBeInTheDocument();
    expect(screen.queryByText('Xem hàng chờ')).not.toBeInTheDocument();
  });

  it('có việc -> số ở màu chữ chính (không mờ)', () => {
    render(withIntl(<AdminQueueCard definition={disputes} count={14} />));

    expect(screen.getByText('14')).toHaveClass('text-foreground');
    expect(screen.getByText('14')).not.toHaveClass('text-muted-foreground');
  });
});
