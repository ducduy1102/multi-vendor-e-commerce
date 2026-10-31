import { afterEach, describe, expect, it, vi } from 'vitest';

import { createReport } from './report.service';

const REVIEW_ID = '11111111-1111-4111-8111-111111111111';

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

function lastCall(): [string, RequestInit] {
  return vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('report.service — createReport', () => {
  const receipt = {
    id: 'report-1',
    targetType: 'REVIEW',
    status: 'OPEN',
    createdAt: '2026-10-31T01:00:00.000Z',
  };

  it('POST /reports kèm cookie, body đúng đối tượng + lý do + ghi chú, trả biên nhận đã parse', async () => {
    mockFetchOnce({ success: true, data: { report: receipt } }, 201);

    const result = await createReport({
      targetType: 'REVIEW',
      targetId: REVIEW_ID,
      reasonCode: 'SPAM',
      note: 'Quảng cáo liên tục',
    });

    expect(result).toEqual(receipt);
    const [url, init] = lastCall();
    expect(url).toMatch(/\/reports$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({
      targetType: 'REVIEW',
      targetId: REVIEW_ID,
      reasonCode: 'SPAM',
      note: 'Quảng cáo liên tục',
    });
  });

  it('field thừa của BE (vd ghi chú, ảnh chụp, người báo) bị bỏ khi parse biên nhận', async () => {
    mockFetchOnce(
      {
        success: true,
        data: {
          report: { ...receipt, note: 'RIENG-TU', snapshot: { x: 1 }, reporterId: 'user-9' },
        },
      },
      201,
    );

    const result = await createReport({
      targetType: 'REVIEW',
      targetId: REVIEW_ID,
      reasonCode: 'SPAM',
    });

    expect(JSON.stringify(result)).not.toMatch(/RIENG-TU|snapshot|reporterId/);
  });

  it('phản hồi sai hình dạng ⇒ ném lỗi, không trả dữ liệu hỏng', async () => {
    mockFetchOnce({ success: true, data: { report: { id: 1 } } }, 201);

    await expect(
      createReport({ targetType: 'REVIEW', targetId: REVIEW_ID, reasonCode: 'SPAM' }),
    ).rejects.toThrow();
  });

  it('lỗi nghiệp vụ giữ nguyên mã để hook dịch (409 REPORT_ALREADY_OPEN)', async () => {
    mockFetchOnce(
      { success: false, message: 'Already reported', code: 'REPORT_ALREADY_OPEN' },
      409,
    );

    await expect(
      createReport({ targetType: 'REVIEW', targetId: REVIEW_ID, reasonCode: 'SPAM' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
