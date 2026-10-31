import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as reportService from '../services/report.service';
import { useCreateReport } from './useCreateReport';

vi.mock('../services/report.service', () => ({ createReport: vi.fn() }));

const INPUT = {
  targetType: 'REVIEW' as const,
  targetId: '11111111-1111-4111-8111-111111111111',
  reasonCode: 'SPAM' as const,
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCreateReport(), { wrapper });
}

beforeEach(() => {
  vi.mocked(reportService.createReport).mockReset();
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('useCreateReport', () => {
  it('gọi service với đúng input và trả biên nhận', async () => {
    const receipt = {
      id: 'report-1',
      targetType: 'REVIEW' as const,
      status: 'OPEN' as const,
      createdAt: '2026-10-31T01:00:00.000Z',
    };
    vi.mocked(reportService.createReport).mockResolvedValue(receipt);
    const { result } = setup();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync(INPUT);
    });

    expect(returned).toEqual(receipt);
    expect(vi.mocked(reportService.createReport).mock.calls[0][0]).toEqual(INPUT);
  });

  it('MẤT MẠNG (navigator.onLine=false): vẫn gọi service và báo lỗi, KHÔNG treo ở trạng thái "đang gửi" (networkMode always)', async () => {
    onlineManager.setOnline(false);
    vi.mocked(reportService.createReport).mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = setup();

    await act(async () => {
      await result.current.mutateAsync(INPUT).catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(reportService.createReport).toHaveBeenCalledTimes(1);
    expect(result.current.isPaused).toBe(false);
  });
});
