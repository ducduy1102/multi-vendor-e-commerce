import { REPORT_RESOLUTION_ACTIONS } from '@ecommerce/types';
import { describe, expect, it } from 'vitest';

import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import {
  ADMIN_PLUGGED_REPORT_ACTIONS,
  ADMIN_REPORT_ACTION_COPY,
  ADMIN_REPORT_SLOW_AFTER_MS,
  ADMIN_REPORT_TAB_DISPLAY,
  ADMIN_REPORT_TYPE_DISPLAY,
  adminReportTargetTitle,
  availableAdminReportActions,
  canReopenReportedReview,
  describeAdminReportResult,
  isAdminReportSlow,
} from './admin-report-display';
import {
  makeConversationReport,
  makeProductReport,
  makeResolvedReport,
  makeReviewReport,
  makeShopReport,
} from './admin-report.fixtures';

const MESSAGES = { vi: viMessages.admin, en: enMessages.admin } as Record<
  'vi' | 'en',
  Record<string, string>
>;
const HOUR = 60 * 60 * 1000;
const CREATED = '2026-10-29T08:00:00.000Z';
const createdAt = Date.parse(CREATED);

describe('isAdminReportSlow — mốc "Chờ lâu" 48 giờ (suy từ giờ, không lưu ở DB)', () => {
  const open = { status: 'OPEN' as const, createdAt: CREATED };

  it('mốc là 48 giờ', () => {
    expect(ADMIN_REPORT_SLOW_AFTER_MS).toBe(48 * HOUR);
  });

  it.each([
    ['vừa gửi', 0, false],
    ['47 giờ 59 phút', 48 * HOUR - 60_000, false],
    ['đúng 48 giờ', 48 * HOUR, true],
    ['3 ngày', 72 * HOUR, true],
  ])('báo cáo đang mở, đã chờ %s ⇒ %s', (_name, waited, expected) => {
    expect(isAdminReportSlow(open, createdAt + waited)).toBe(expected);
  });

  it.each(['RESOLVED', 'DISMISSED'] as const)(
    'báo cáo đã đóng (%s) KHÔNG BAO GIỜ bị gắn "Chờ lâu", dù cũ đến đâu',
    (status) => {
      expect(isAdminReportSlow({ status, createdAt: CREATED }, createdAt + 999 * HOUR)).toBe(false);
    },
  );

  it('ngày sai dạng (NaN) ⇒ false, một dòng hỏng không bị gắn nhãn nhầm', () => {
    expect(isAdminReportSlow({ status: 'OPEN', createdAt: 'khong-phai-ngay' }, Date.now())).toBe(
      false,
    );
  });
});

describe('availableAdminReportActions — hành động chọn được cho từng loại', () => {
  it.each([
    ['đánh giá', makeReviewReport(), ['HIDE_REVIEW', 'DISMISS']],
    ['shop', makeShopReport(), ['SUSPEND_SHOP', 'DISMISS']],
    // TAKE_DOWN_PRODUCT (5.7) chưa có bộ xử lý ở BE ⇒ chưa hiện.
    ['sản phẩm', makeProductReport(), ['DISMISS']],
    // BLOCK_BUYER (6.2) cũng chưa có bộ xử lý ⇒ chủ shop báo hội thoại chỉ còn khoá tài khoản + bỏ qua.
    [
      'hội thoại (chủ shop báo)',
      makeConversationReport({
        snapshot: { shopName: 'S', buyerName: 'B', reporterRole: 'SHOP' },
      }),
      ['SUSPEND_REPORTED_USER', 'DISMISS'],
    ],
    [
      'hội thoại (người mua báo)',
      makeConversationReport({
        snapshot: { shopName: 'S', buyerName: 'B', reporterRole: 'BUYER' },
      }),
      ['SUSPEND_REPORTED_USER', 'DISMISS'],
    ],
  ])('%s', (_name, report, expected) => {
    expect(availableAdminReportActions(report)).toEqual(expected);
  });

  it('MỌI loại đều luôn có "Bỏ qua" (panel Xử lý không bao giờ rỗng)', () => {
    for (const report of [
      makeReviewReport(),
      makeShopReport(),
      makeProductReport(),
      makeConversationReport(),
    ]) {
      expect(availableAdminReportActions(report)).toContain('DISMISS');
    }
  });

  it('chỉ trả hành động ĐÃ cắm bộ xử lý', () => {
    for (const report of [makeReviewReport(), makeShopReport(), makeConversationReport()]) {
      for (const action of availableAdminReportActions(report)) {
        expect(ADMIN_PLUGGED_REPORT_ACTIONS).toContain(action);
      }
    }
  });
});

describe('bảng nhãn', () => {
  it('mọi hành động đã cắm có đủ nhãn + mô tả + nút + hộp thoại ở CẢ hai ngôn ngữ', () => {
    for (const action of ADMIN_PLUGGED_REPORT_ACTIONS) {
      const copy = ADMIN_REPORT_ACTION_COPY[action];
      const keys = [
        copy.labelKey,
        copy.descriptionKey,
        copy.submitKey,
        copy.confirmTitleKey,
        copy.confirmDescriptionKey,
        copy.confirmKey,
        ...(copy.noteVisibilityKey ? [copy.noteVisibilityKey] : []),
      ];
      for (const key of keys) {
        for (const locale of ['vi', 'en'] as const) {
          expect(MESSAGES[locale][key], `${locale}.admin.${key} (${action})`).toBeTruthy();
        }
      }
    }
  });

  it('chỉ "Bỏ qua" là hành động không mang tính hạn chế và không cần ghi chú hiển thị cho ai', () => {
    expect(ADMIN_REPORT_ACTION_COPY.DISMISS.isCautionary).toBe(false);
    expect(ADMIN_REPORT_ACTION_COPY.DISMISS.noteVisibilityKey).toBeNull();
    for (const action of ['HIDE_REVIEW', 'SUSPEND_SHOP', 'SUSPEND_REPORTED_USER'] as const) {
      expect(ADMIN_REPORT_ACTION_COPY[action].isCautionary).toBe(true);
      expect(ADMIN_REPORT_ACTION_COPY[action].noteVisibilityKey).not.toBeNull();
    }
  });

  it('nhãn tab, loại đối tượng và kết quả đều có bản dịch vi + en', () => {
    const keys = [
      ...Object.values(ADMIN_REPORT_TAB_DISPLAY).flatMap((d) => [
        d.tabLabelKey,
        d.emptyKey,
        d.emptyHintKey,
      ]),
      ...Object.values(ADMIN_REPORT_TYPE_DISPLAY).map((d) => d.labelKey),
      ...REPORT_RESOLUTION_ACTIONS.map((action) => describeAdminReportResult(action).labelKey),
      describeAdminReportResult('MA_LA').labelKey,
    ];
    for (const key of keys) {
      for (const locale of ['vi', 'en'] as const) {
        expect(MESSAGES[locale][key], `${locale}.admin.${key}`).toBeTruthy();
      }
    }
  });
});

describe('describeAdminReportResult', () => {
  it('mọi hành động của hợp đồng đều có nhãn riêng; "Bỏ qua" là sắc thái trung tính, còn lại là thành công', () => {
    for (const action of REPORT_RESOLUTION_ACTIONS) {
      const display = describeAdminReportResult(action);
      expect(display.labelKey).not.toBe('reportResultUnknown');
      expect(display.tone).toBe(action === 'DISMISS' ? 'muted' : 'success');
    }
  });

  it.each(['TAKE_DOWN_PRODUCT_V2', '', 'toString', '__proto__', 'constructor'])(
    'hành động lạ %j ⇒ nhãn chung, không ném lỗi và không đọc thuộc tính của Object',
    (action) => {
      expect(describeAdminReportResult(action)).toEqual({
        labelKey: 'reportResultUnknown',
        tone: 'muted',
      });
    },
  );
});

describe('canReopenReportedReview', () => {
  it('chỉ báo cáo ĐÁNH GIÁ đã xử lý bằng HIDE_REVIEW mới mở lại được', () => {
    expect(canReopenReportedReview(makeResolvedReport())).toBe(true);
  });

  it.each([
    ['còn đang mở', makeReviewReport()],
    ['đánh giá nhưng chỉ bị bỏ qua', makeResolvedReport({}, { action: 'DISMISS' })],
    [
      'đã ẩn nhưng là shop',
      makeResolvedReport({ ...makeShopReport(), status: 'RESOLVED' } as never, {
        action: 'SUSPEND_SHOP',
      }),
    ],
    // Ba ca dưới đây chỉ khác bản "mở lại được" ở MỘT điều kiện (dữ liệu lệch, BE không tạo ra): khoá từng điều kiện riêng để bỏ
    // một điều kiện bất kỳ là test đỏ. Ca "đã ẩn nhưng là shop" ở trên không cô lập được loại đối tượng — bản shop ghi đè luôn
    // `resolution` thành null — nên không thay được ca thứ nhất dưới đây.
    [
      'báo cáo shop mà hành động ghi là ẩn đánh giá',
      {
        ...makeShopReport(),
        status: 'RESOLVED',
        resolution: makeResolvedReport().resolution,
      } as never,
    ],
    ['đã xử lý nhưng trạng thái còn OPEN', makeResolvedReport({ status: 'OPEN' })],
    [
      'trạng thái DISMISSED dù hành động ghi là ẩn đánh giá',
      makeResolvedReport({ status: 'DISMISSED' }),
    ],
  ])('%s ⇒ không', (_name, report) => {
    expect(canReopenReportedReview(report)).toBe(false);
  });
});

describe('adminReportTargetTitle', () => {
  it('đánh giá: số sao + tên sản phẩm; shop và sản phẩm: tên; hội thoại: hai bên', () => {
    expect(adminReportTargetTitle(makeReviewReport())).toBe('1★ · Áo thun cotton cổ tròn unisex');
    expect(adminReportTargetTitle(makeShopReport())).toBe('Shop Hàng Hiệu Giá Sỉ');
    expect(adminReportTargetTitle(makeProductReport())).toBe('Dao bấm tự động lò xo 21cm');
    expect(adminReportTargetTitle(makeConversationReport())).toBe(
      'Nguyễn Thị Hồng ↔ Gia Dụng Xinh',
    );
  });
});
