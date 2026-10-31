import {
  clipNotificationLabel,
  clipOptionalNotificationLabel,
  isNotificationDataWithinLimit,
  listNotificationsQuerySchema,
  markAllNotificationsReadResultSchema,
  markNotificationReadResultSchema,
  NOTIFICATION_DATA_MAX_BYTES,
  NOTIFICATION_LABEL_MAX_LENGTH,
  NOTIFICATION_REASON_MAX_LENGTH,
  NOTIFICATION_TYPE_MAX_LENGTH,
  NOTIFICATION_TYPES,
  NOTIFICATIONS_MAX_PAGE_SIZE,
  NOTIFICATIONS_PAGE_SIZE,
  notificationContentSchema,
  notificationListSchema,
  notificationNewEventSchema,
  notificationSchema,
  notificationUnreadCountSchema,
  notificationWriteSchema,
  REALTIME_EVENTS,
  type NotificationType,
} from '@ecommerce/types';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Schema dùng chung của thông báo (packages/types/src/notification.ts, Week10.md 7.2). Là hợp đồng giữa BE và FE nên
// test ở đây khoá hình dạng: mỗi loại cần dữ liệu gì, client KHÔNG nhét được trường nào vào, nhãn luôn là một dòng an
// toàn và vừa kích thước, loại lạ rơi về thông báo chung thay vì làm hỏng cả danh sách, và các con số khớp với CHECK
// của DB. Ký tự đặc biệt dựng bằng String.fromCharCode để tệp nguồn không chứa ký tự điều khiển thật.
const ORDER_ID = '2c6f6d3a-8d4b-4f55-9a52-0d9a2b6a7c11';
const PRODUCT_ID = '9b1e0c52-3f64-4a8e-b6a2-5d7c8e1f2a33';
const SHOP_ID = '5d0f6a3e-2f7b-4e0b-8a8f-6c1d2e3f4a55';
const ID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_ID = '11111111-2222-4333-8444-555555555555';
const THIRD_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const ISO = '2030-01-01T10:00:00.000Z';

const NUL = String.fromCharCode(0);
const BIDI_OVERRIDE = String.fromCharCode(0x202e);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const BOM = String.fromCharCode(0xfeff);

// Một dữ liệu hợp lệ cho MỖI loại. Kiểu Record<NotificationType, ...> khiến thêm loại mà quên mẫu là lỗi biên dịch.
const VALID: Record<NotificationType, Record<string, unknown>> = {
  ORDER_NEW: { orderId: ORDER_ID },
  ORDER_CONFIRMED: { orderId: ORDER_ID, shopName: 'Cửa hàng Ánh Dương' },
  ORDER_SHIPPED: { orderId: ORDER_ID, shopName: 'Cửa hàng Ánh Dương' },
  ORDER_CANCELLED: {
    orderId: ORDER_ID,
    audience: 'BUYER',
    by: 'SELLER',
    shopName: 'Cửa hàng Ánh Dương',
    reason: 'Hết hàng',
  },
  ORDER_COMPLETED: { orderId: ORDER_ID, shopName: 'Cửa hàng Ánh Dương' },
  REFUND_REQUEST_NEW: { orderId: ORDER_ID, kind: 'RETURN' },
  REFUND_REQUEST_APPROVED: { orderId: ORDER_ID, kind: 'CANCEL' },
  REFUND_REQUEST_REJECTED: {
    orderId: ORDER_ID,
    kind: 'RETURN',
    reason: 'Sản phẩm đã qua sử dụng',
  },
  REFUND_REQUEST_ESCALATED: {
    orderId: ORDER_ID,
    kind: 'RETURN',
    audience: 'ADMIN',
  },
  REFUND_REQUEST_DECIDED_BY_ADMIN: {
    orderId: ORDER_ID,
    kind: 'CANCEL',
    outcome: 'APPROVED',
  },
  REFUND_COMPLETED: { orderId: ORDER_ID },
  REVIEW_NEW: {
    productId: PRODUCT_ID,
    productName: 'Áo thun cotton',
    rating: 5,
  },
  REVIEW_REPLIED: {
    productId: PRODUCT_ID,
    productName: 'Áo thun cotton',
    shopName: 'Cửa hàng Ánh Dương',
  },
  SHOP_STATUS_CHANGED: {
    shopId: SHOP_ID,
    status: 'SUSPENDED',
    reason: 'Vi phạm chính sách',
  },
  ADMIN_SHOP_PENDING: { shopId: SHOP_ID, shopName: 'Cửa hàng mới' },
  ADMIN_APPEAL_PENDING: {
    appealId: '9b2c4d6e-1234-4abc-8def-0123456789ab',
    shopId: SHOP_ID,
    shopName: 'Cửa hàng bị khoá',
  },
  APPEAL_DECIDED: {
    appealId: '9b2c4d6e-1234-4abc-8def-0123456789ab',
    shopId: SHOP_ID,
    decision: 'ACCEPTED',
  },
  REPORT_NEW: {
    reportId: '9b2c4d6e-1234-4abc-8def-0123456789ac',
    targetType: 'REVIEW',
  },
  REPORT_RESOLVED: {
    reportId: '9b2c4d6e-1234-4abc-8def-0123456789ad',
    targetType: 'SHOP',
    outcome: 'DISMISSED',
  },
  REVIEW_HIDDEN: { orderId: ORDER_ID, productName: 'Áo thun cotton' },
};

const write = (type: unknown, data: unknown) =>
  notificationWriteSchema.safeParse({ type, data });
const item = (
  type: unknown,
  data: unknown,
  overrides: Record<string, unknown> = {},
) => ({
  id: ID,
  readAt: null,
  createdAt: ISO,
  type,
  data,
  ...overrides,
});

// Nhãn dài nhất có thể, toàn ký tự 3 byte UTF-8 (ca xấu nhất cho giới hạn byte).
const wide = (length: number) => '漢'.repeat(length);
function worstCaseData(type: NotificationType): Record<string, unknown> {
  const data = { ...VALID[type] };
  for (const key of ['shopName', 'productName']) {
    if (key in data) data[key] = wide(NOTIFICATION_LABEL_MAX_LENGTH);
  }
  if ('reason' in data) data.reason = wide(NOTIFICATION_REASON_MAX_LENGTH);
  return data;
}

describe('danh sách loại thông báo', () => {
  it('có đủ 20 loại, không trùng, đúng dạng IN_HOA_GẠCH_DƯỚI và vừa cột type', () => {
    expect(NOTIFICATION_TYPES).toHaveLength(20);
    expect(new Set(NOTIFICATION_TYPES).size).toBe(NOTIFICATION_TYPES.length);
    for (const type of NOTIFICATION_TYPES) {
      expect(type).toMatch(/^[A-Z][A-Z_]*$/);
      expect(type.length).toBeLessThanOrEqual(NOTIFICATION_TYPE_MAX_LENGTH);
    }
  });

  it('mọi loại đều có mẫu dữ liệu hợp lệ trong bảng của test này (không bỏ sót loại nào)', () => {
    expect(Object.keys(VALID).sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });
});

describe('schema ghi (notificationWriteSchema)', () => {
  describe('chấp nhận', () => {
    it.each(NOTIFICATION_TYPES.map((type) => [type]))(
      '%s với dữ liệu hợp lệ',
      (type) => {
        const result = write(type, VALID[type]);

        expect(result.success).toBe(true);
        expect(result.success && result.data).toEqual({
          type,
          data: VALID[type],
        });
      },
    );

    it.each([
      ['ORDER_CANCELLED', 'reason'],
      ['REFUND_REQUEST_REJECTED', 'reason'],
      ['SHOP_STATUS_CHANGED', 'reason'],
    ] as const)('%s: trường %s là tuỳ chọn', (type, key) => {
      const data = { ...VALID[type] };
      delete data[key];

      expect(write(type, data).success).toBe(true);
    });

    it('mọi cặp (audience, by) hợp lệ của ORDER_CANCELLED', () => {
      for (const audience of ['BUYER', 'SELLER']) {
        for (const by of ['BUYER', 'SELLER', 'ADMIN', 'SYSTEM']) {
          expect(
            write('ORDER_CANCELLED', { ...VALID.ORDER_CANCELLED, audience, by })
              .success,
          ).toBe(true);
        }
      }
    });

    it.each(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'])(
      'SHOP_STATUS_CHANGED nhận trạng thái %s',
      (status) => {
        expect(
          write('SHOP_STATUS_CHANGED', { shopId: SHOP_ID, status }).success,
        ).toBe(true);
      },
    );

    it.each([1, 2, 3, 4, 5])('REVIEW_NEW nhận điểm %i', (rating) => {
      expect(write('REVIEW_NEW', { ...VALID.REVIEW_NEW, rating }).success).toBe(
        true,
      );
    });
  });

  describe('từ chối', () => {
    it.each([
      ['loại không có trong danh sách', 'ORDER_EXPLODED'],
      ['loại viết thường', 'order_new'],
      ['loại rỗng', ''],
      ['loại là số', 7],
      ['loại null', null],
    ])('%s', (_name, type) => {
      expect(write(type, { orderId: ORDER_ID }).success).toBe(false);
    });

    it('thiếu type hoặc thiếu data', () => {
      expect(
        notificationWriteSchema.safeParse({ data: { orderId: ORDER_ID } })
          .success,
      ).toBe(false);
      expect(
        notificationWriteSchema.safeParse({ type: 'ORDER_NEW' }).success,
      ).toBe(false);
      expect(notificationWriteSchema.safeParse(null).success).toBe(false);
    });

    it.each(['ORDER_NEW', 'REFUND_COMPLETED'] as const)(
      '%s: data là null, mảng, chuỗi hoặc số',
      (type) => {
        for (const data of [null, [], 'x', 42]) {
          expect(write(type, data).success).toBe(false);
        }
      },
    );

    it.each(NOTIFICATION_TYPES.map((type) => [type]))(
      '%s: KHOÁ LẠ bị từ chối (vd url)',
      (type) => {
        expect(
          write(type, { ...VALID[type], url: 'https://evil.example/phish' })
            .success,
        ).toBe(false);
        expect(write(type, { ...VALID[type], href: '/admin' }).success).toBe(
          false,
        );
        expect(
          write(type, { ...VALID[type], email: 'a@b.c', phone: '0900000000' })
            .success,
        ).toBe(false);
      },
    );

    it.each(NOTIFICATION_TYPES.map((type) => [type]))(
      '%s: thiếu bất kỳ trường bắt buộc nào đều bị từ chối',
      (type) => {
        const optional = new Set(['reason']);
        for (const key of Object.keys(VALID[type]).filter(
          (k) => !optional.has(k),
        )) {
          const data = { ...VALID[type] };
          delete data[key];

          expect(write(type, data).success).toBe(false);
        }
      },
    );

    it.each(NOTIFICATION_TYPES.map((type) => [type]))(
      '%s: id không phải UUID bị từ chối',
      (type) => {
        for (const key of Object.keys(VALID[type]).filter((k) =>
          k.endsWith('Id'),
        )) {
          for (const bad of [
            'abc',
            '',
            '123',
            `${ORDER_ID}x`,
            '../../etc/passwd',
            '<script>',
          ]) {
            expect(write(type, { ...VALID[type], [key]: bad }).success).toBe(
              false,
            );
          }
        }
      },
    );

    it.each([
      ['kind ngoài danh sách', 'REFUND_REQUEST_NEW', { kind: 'EXCHANGE' }],
      [
        'audience ngoài danh sách ở ORDER_CANCELLED (ADMIN không nhận loại này)',
        'ORDER_CANCELLED',
        { audience: 'ADMIN' },
      ],
      [
        'audience ngoài danh sách ở REFUND_REQUEST_ESCALATED (BUYER không nhận loại này)',
        'REFUND_REQUEST_ESCALATED',
        { audience: 'BUYER' },
      ],
      ['by ngoài danh sách', 'ORDER_CANCELLED', { by: 'ROOT' }],
      [
        'outcome ngoài danh sách',
        'REFUND_REQUEST_DECIDED_BY_ADMIN',
        { outcome: 'ESCALATED' },
      ],
      [
        'status shop ngoài danh sách',
        'SHOP_STATUS_CHANGED',
        { status: 'DELETED' },
      ],
      ['điểm 0', 'REVIEW_NEW', { rating: 0 }],
      ['điểm 6', 'REVIEW_NEW', { rating: 6 }],
      ['điểm lẻ', 'REVIEW_NEW', { rating: 4.5 }],
      ['điểm là chuỗi', 'REVIEW_NEW', { rating: '5' }],
    ] as const)('%s', (_name, type, patch) => {
      expect(write(type, { ...VALID[type], ...patch }).success).toBe(false);
    });
  });

  describe('nhãn (tên shop, tên sản phẩm, lý do)', () => {
    it('chấp nhận đúng giới hạn và từ chối vượt một đơn vị', () => {
      expect(
        write('ORDER_CONFIRMED', {
          orderId: ORDER_ID,
          shopName: 'a'.repeat(NOTIFICATION_LABEL_MAX_LENGTH),
        }).success,
      ).toBe(true);
      expect(
        write('ORDER_CONFIRMED', {
          orderId: ORDER_ID,
          shopName: 'a'.repeat(NOTIFICATION_LABEL_MAX_LENGTH + 1),
        }).success,
      ).toBe(false);
      expect(
        write('REFUND_REQUEST_REJECTED', {
          ...VALID.REFUND_REQUEST_REJECTED,
          reason: 'a'.repeat(NOTIFICATION_REASON_MAX_LENGTH),
        }).success,
      ).toBe(true);
      expect(
        write('REFUND_REQUEST_REJECTED', {
          ...VALID.REFUND_REQUEST_REJECTED,
          reason: 'a'.repeat(NOTIFICATION_REASON_MAX_LENGTH + 1),
        }).success,
      ).toBe(false);
    });

    it.each([
      ['rỗng', ''],
      ['có xuống dòng', 'dòng 1\ndòng 2'],
      ['có NUL', `a${NUL}b`],
      ['có bidi-override', `a${BIDI_OVERRIDE}b`],
      ['có dấu phân dòng Unicode', `a${LINE_SEPARATOR}b`],
      ['có BOM', `${BOM}a`],
      ['có tab', 'a\tb'],
    ])('nhãn %s bị từ chối', (_name, shopName) => {
      expect(
        write('ORDER_CONFIRMED', { orderId: ORDER_ID, shopName }).success,
      ).toBe(false);
    });

    it('nhãn chứa <img onerror> và chữ trông như URL được CHẤP NHẬN và giữ nguyên văn (React escape khi hiển thị; không có trường URL)', () => {
      const shopName = '<img src=x onerror=alert(1)> https://evil.example';

      const result = write('ORDER_CONFIRMED', { orderId: ORDER_ID, shopName });

      expect(
        result.success && (result.data.data as { shopName: string }).shopName,
      ).toBe(shopName);
    });
  });

  describe('giới hạn kích thước data', () => {
    it.each(NOTIFICATION_TYPES.map((type) => [type]))(
      '%s: ca xấu nhất (mọi nhãn dài tối đa, ký tự 3 byte) vẫn dưới giới hạn byte',
      (type) => {
        const data = worstCaseData(type);

        const result = write(type, data);

        expect(result.success).toBe(true);
        expect(
          Buffer.byteLength(JSON.stringify(data), 'utf8'),
        ).toBeLessThanOrEqual(NOTIFICATION_DATA_MAX_BYTES);
      },
    );

    it('loại lớn nhất vẫn có biên an toàn rõ rệt dưới 1024 byte', () => {
      const biggest = Math.max(
        ...NOTIFICATION_TYPES.map((type) =>
          Buffer.byteLength(JSON.stringify(worstCaseData(type)), 'utf8'),
        ),
      );

      expect(biggest).toBeLessThan(NOTIFICATION_DATA_MAX_BYTES * 0.8);
    });

    it('isNotificationDataWithinLimit đếm BYTE UTF-8 của JSON gọn: đúng cận thì qua, hơn một byte thì không', () => {
      const overhead = Buffer.byteLength(JSON.stringify({ k: '' }), 'utf8');
      const exact = { k: 'a'.repeat(NOTIFICATION_DATA_MAX_BYTES - overhead) };

      expect(Buffer.byteLength(JSON.stringify(exact), 'utf8')).toBe(
        NOTIFICATION_DATA_MAX_BYTES,
      );
      expect(isNotificationDataWithinLimit(exact)).toBe(true);
      expect(isNotificationDataWithinLimit({ k: `${exact.k}a` })).toBe(false);
    });

    it('đếm byte chứ không đếm ký tự: 400 chữ 3 byte (1200 byte) vượt giới hạn dù chỉ 400 ký tự', () => {
      expect(isNotificationDataWithinLimit({ k: wide(400) })).toBe(false);
      expect(isNotificationDataWithinLimit({ k: wide(300) })).toBe(true);
    });
  });

  it('khoá ở ngoài type/data (vd userId do client gửi) bị loại bỏ, không đi vào kết quả', () => {
    const result = notificationWriteSchema.safeParse({
      type: 'ORDER_NEW',
      data: { orderId: ORDER_ID },
      userId: 'someone-else',
      readAt: ISO,
    });

    expect(result.success && result.data).toEqual({
      type: 'ORDER_NEW',
      data: { orderId: ORDER_ID },
    });
  });

  it('notificationContentSchema (không kiểm byte) chấp nhận đúng những gì schema ghi chấp nhận với dữ liệu hợp lệ', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(
        notificationContentSchema.safeParse({ type, data: VALID[type] })
          .success,
      ).toBe(true);
    }
  });
});

describe('clipNotificationLabel', () => {
  it('giữ nguyên chuỗi ngắn hợp lệ', () => {
    expect(clipNotificationLabel('Cửa hàng Ánh Dương', 60)).toBe(
      'Cửa hàng Ánh Dương',
    );
  });

  it('cắt khoảng trắng hai đầu và gộp mọi khoảng trắng/xuống dòng/tab thành MỘT dấu cách', () => {
    expect(clipNotificationLabel('  hết   hàng\n\nrồi\t nhé  ', 60)).toBe(
      'hết hàng rồi nhé',
    );
  });

  it('bỏ NUL và bidi-override; BOM và dấu phân dòng Unicode được coi là khoảng trắng nên thành một dấu cách', () => {
    expect(clipNotificationLabel(`a${NUL}b${BIDI_OVERRIDE}c${BOM}d`, 60)).toBe(
      'abc d',
    );
    expect(clipNotificationLabel(`a ${NUL} b`, 60)).toBe('a b');
    expect(clipNotificationLabel(`a${LINE_SEPARATOR}b`, 60)).toBe('a b');
  });

  it('chuỗi dài bị cắt về ĐÚNG maxLength và kết thúc bằng dấu …', () => {
    const clipped = clipNotificationLabel('a'.repeat(200), 60);

    expect(clipped).toHaveLength(60);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped).toBe(`${'a'.repeat(59)}…`);
  });

  it('chuỗi đúng maxLength không bị cắt', () => {
    expect(clipNotificationLabel('a'.repeat(60), 60)).toBe('a'.repeat(60));
  });

  it('không cắt đôi cặp thay thế UTF-16 (emoji nằm đúng ranh giới)', () => {
    const emoji = '😀';
    expect(emoji).toHaveLength(2);
    // 58 chữ + emoji (2 đơn vị) = 60: đủ chỗ. Thêm một chữ nữa ⇒ phải cắt, và điểm cắt rơi giữa emoji.
    const clipped = clipNotificationLabel(`${'a'.repeat(58)}${emoji}b`, 60);

    expect(clipped.length).toBeLessThanOrEqual(60);
    expect(clipped.endsWith('…')).toBe(true);
    for (const char of clipped) {
      const code = char.charCodeAt(0);
      expect(code >= 0xd800 && code <= 0xdfff && char.length === 1).toBe(false); // không còn đơn vị thay thế lẻ
    }
  });

  it('chuỗi chỉ gồm khoảng trắng/ký tự điều khiển ⇒ rỗng', () => {
    expect(clipNotificationLabel(`  \n\t ${NUL}  `, 60)).toBe('');
  });

  it('kết quả của chuỗi tuỳ ý (kể cả rác ngẫu nhiên) luôn qua schema ghi khi không rỗng — notify không thất bại vì chữ lạ', () => {
    // Bộ sinh giả ngẫu nhiên có hạt giống cố định để test tất định.
    let seed = 20261022;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed;
    };
    const alphabet = [
      'a',
      'Z',
      '9',
      ' ',
      ' ',
      '\n',
      '\t',
      '\r',
      'đ',
      'ệ',
      '漢',
      '😀',
      '<',
      '>',
      '&',
      '"',
      "'",
      NUL,
      BIDI_OVERRIDE,
      LINE_SEPARATOR,
      BOM,
      String.fromCharCode(0x7f),
      String.fromCharCode(0x85),
    ];
    for (let i = 0; i < 500; i++) {
      const length = next() % 400;
      let raw = '';
      for (let j = 0; j < length; j++)
        raw += alphabet[next() % alphabet.length];

      const label = clipNotificationLabel(raw, NOTIFICATION_LABEL_MAX_LENGTH);
      const reason = clipNotificationLabel(raw, NOTIFICATION_REASON_MAX_LENGTH);

      expect(label.length).toBeLessThanOrEqual(NOTIFICATION_LABEL_MAX_LENGTH);
      if (label !== '') {
        expect(
          write('ORDER_CONFIRMED', { orderId: ORDER_ID, shopName: label })
            .success,
        ).toBe(true);
      }
      if (reason !== '') {
        expect(
          write('SHOP_STATUS_CHANGED', {
            shopId: SHOP_ID,
            status: 'SUSPENDED',
            reason,
          }).success,
        ).toBe(true);
      }
    }
  });
});

describe('clipOptionalNotificationLabel', () => {
  it.each([[undefined], [null], [''], ['   '], [`${NUL}`], ['\n\t']])(
    '%j ⇒ undefined (bỏ hẳn khoá)',
    (value) => {
      expect(clipOptionalNotificationLabel(value, 60)).toBeUndefined();
    },
  );

  it('chuỗi có chữ ⇒ nhãn đã cắt gọn', () => {
    expect(clipOptionalNotificationLabel('  Hết hàng  ', 60)).toBe('Hết hàng');
    expect(clipOptionalNotificationLabel('a'.repeat(300), 120)).toHaveLength(
      120,
    );
  });
});

describe('schema đọc (notificationSchema)', () => {
  it.each(NOTIFICATION_TYPES.map((type) => [type]))(
    '%s: phần tử đã biết được giữ nguyên loại và dữ liệu',
    (type) => {
      const parsed = notificationSchema.parse(item(type, VALID[type]));

      expect(parsed).toEqual(item(type, VALID[type]));
    },
  );

  it('thu hẹp kiểu theo type (kiểm tra lúc biên dịch: truy cập orderId chỉ hợp lệ sau khi so type)', () => {
    const parsed = notificationSchema.parse(
      item('ORDER_NEW', { orderId: ORDER_ID }),
    );

    expect(parsed.type === 'ORDER_NEW' && parsed.data.orderId).toBe(ORDER_ID);
  });

  it('readAt có giá trị được giữ nguyên', () => {
    const parsed = notificationSchema.parse(
      item('ORDER_NEW', { orderId: ORDER_ID }, { readAt: ISO }),
    );

    expect(parsed.readAt).toBe(ISO);
  });

  describe('loại lạ hoặc dữ liệu hỏng rơi về thông báo chung, KHÔNG làm hỏng phần còn lại', () => {
    it('loại không có trong danh sách (BE mới hơn FE) ⇒ UNKNOWN, data rỗng', () => {
      const parsed = notificationSchema.parse(
        item('PROMO_BLAST', { title: 'Giảm 90%', url: 'https://evil.example' }),
      );

      expect(parsed).toEqual({
        id: ID,
        readAt: null,
        createdAt: ISO,
        type: 'UNKNOWN',
        data: {},
      });
    });

    it('loại đã biết nhưng dữ liệu sai hình dạng ⇒ UNKNOWN, và dữ liệu sai KHÔNG được chuyển tiếp', () => {
      const parsed = notificationSchema.parse(
        item('ORDER_NEW', {
          orderId: 'không-phải-uuid',
          url: 'https://evil.example',
        }),
      );

      expect(parsed.type).toBe('UNKNOWN');
      expect(parsed.data).toEqual({});
    });

    it('loại đã biết nhưng dữ liệu có khoá lạ ⇒ UNKNOWN', () => {
      expect(
        notificationSchema.parse(
          item('ORDER_NEW', { orderId: ORDER_ID, url: 'https://x.y' }),
        ).type,
      ).toBe('UNKNOWN');
    });

    it('data thiếu hẳn ⇒ vẫn là UNKNOWN (không ném)', () => {
      expect(
        notificationSchema.parse({
          id: ID,
          readAt: null,
          createdAt: ISO,
          type: 'ORDER_NEW',
        }).type,
      ).toBe('UNKNOWN');
    });

    it('một phần tử lạ giữa danh sách không làm hỏng danh sách', () => {
      const list = notificationListSchema.parse({
        items: [
          item('ORDER_NEW', { orderId: ORDER_ID }),
          item('PROMO_BLAST', {}, { id: OTHER_ID }),
          item('REFUND_COMPLETED', { orderId: ORDER_ID }, { id: THIRD_ID }),
        ],
        nextCursor: null,
      });

      expect(list.items.map((n) => n.type)).toEqual([
        'ORDER_NEW',
        'UNKNOWN',
        'REFUND_COMPLETED',
      ]);
    });
  });

  describe('vẫn từ chối phần khung hỏng', () => {
    it.each([
      ['id không phải UUID', { id: 'abc' }],
      ['readAt không phải ISO', { readAt: 'hôm qua' }],
      ['readAt là số', { readAt: 123 }],
      ['createdAt thiếu', { createdAt: undefined }],
      ['createdAt không phải ISO', { createdAt: '2030-01-01' }],
    ])('%s', (_name, overrides) => {
      expect(
        notificationSchema.safeParse(
          item('ORDER_NEW', { orderId: ORDER_ID }, overrides),
        ).success,
      ).toBe(false);
    });

    it('type dài hơn cột type (65 ký tự) hoặc rỗng hoặc không phải chuỗi', () => {
      expect(
        notificationSchema.safeParse(
          item('A'.repeat(NOTIFICATION_TYPE_MAX_LENGTH + 1), {}),
        ).success,
      ).toBe(false);
      expect(notificationSchema.safeParse(item('', {})).success).toBe(false);
      expect(notificationSchema.safeParse(item(5, {})).success).toBe(false);
    });
  });
});

describe('danh sách, đếm, đánh dấu đã đọc', () => {
  it('danh sách rỗng và con trỏ null', () => {
    expect(
      notificationListSchema.parse({ items: [], nextCursor: null }),
    ).toEqual({ items: [], nextCursor: null });
  });

  it('con trỏ chỉ gồm ký tự base64url và không quá 120 ký tự', () => {
    expect(
      notificationListSchema.safeParse({ items: [], nextCursor: 'abc_DEF-123' })
        .success,
    ).toBe(true);
    for (const bad of ['', 'a b', 'a/b', 'a+b', '<x>', 'a'.repeat(121)]) {
      expect(
        notificationListSchema.safeParse({ items: [], nextCursor: bad })
          .success,
      ).toBe(false);
    }
  });

  it('unreadCount là số nguyên không âm', () => {
    expect(notificationUnreadCountSchema.parse({ unreadCount: 0 })).toEqual({
      unreadCount: 0,
    });
    for (const bad of [-1, 1.5, '3', null]) {
      expect(
        notificationUnreadCountSchema.safeParse({ unreadCount: bad }).success,
      ).toBe(false);
    }
  });

  it('kết quả đánh dấu đã đọc', () => {
    expect(markNotificationReadResultSchema.parse({ readAt: ISO })).toEqual({
      readAt: ISO,
    });
    expect(
      markNotificationReadResultSchema.safeParse({ readAt: null }).success,
    ).toBe(false);
    expect(
      markAllNotificationsReadResultSchema.parse({ updatedCount: 0 }),
    ).toEqual({ updatedCount: 0 });
    expect(
      markAllNotificationsReadResultSchema.safeParse({ updatedCount: -1 })
        .success,
    ).toBe(false);
  });
});

describe('query danh sách (listNotificationsQuerySchema)', () => {
  it('mặc định: trang đầu, 20 mục, không lọc chưa đọc', () => {
    expect(listNotificationsQuerySchema.parse({})).toEqual({
      limit: NOTIFICATIONS_PAGE_SIZE,
      unreadOnly: false,
    });
    expect(NOTIFICATIONS_PAGE_SIZE).toBe(20);
  });

  it('unreadOnly nhận đúng chuỗi "true"/"false" từ URL — "false" KHÔNG bị coi là true (cạm bẫy của z.coerce.boolean)', () => {
    expect(
      listNotificationsQuerySchema.parse({ unreadOnly: 'true' }).unreadOnly,
    ).toBe(true);
    expect(
      listNotificationsQuerySchema.parse({ unreadOnly: 'false' }).unreadOnly,
    ).toBe(false);
  });

  it.each([['yes'], ['1'], ['0'], ['TRUE'], [''], [true], [1]])(
    'unreadOnly = %j bị từ chối',
    (value) => {
      expect(
        listNotificationsQuerySchema.safeParse({ unreadOnly: value }).success,
      ).toBe(false);
    },
  );

  it('limit là chuỗi số từ URL, trong khoảng 1..50', () => {
    expect(listNotificationsQuerySchema.parse({ limit: '10' }).limit).toBe(10);
    expect(
      listNotificationsQuerySchema.parse({
        limit: String(NOTIFICATIONS_MAX_PAGE_SIZE),
      }).limit,
    ).toBe(50);
    for (const bad of ['0', '-1', '51', '1.5', 'abc', '']) {
      expect(
        listNotificationsQuerySchema.safeParse({ limit: bad }).success,
      ).toBe(false);
    }
  });

  it('cursor chỉ nhận chuỗi mờ hợp lệ', () => {
    expect(
      listNotificationsQuerySchema.parse({ cursor: 'abc_DEF-123' }).cursor,
    ).toBe('abc_DEF-123');
    for (const bad of ['', 'a b', "a'b", 'a;b', 'a'.repeat(121)]) {
      expect(
        listNotificationsQuerySchema.safeParse({ cursor: bad }).success,
      ).toBe(false);
    }
  });

  it('khoá lạ (vd userId) bị loại bỏ — người nhận không bao giờ lấy từ query', () => {
    expect(
      listNotificationsQuerySchema.parse({ userId: 'someone-else' }),
    ).toEqual({ limit: 20, unreadOnly: false });
  });
});

describe('payload notification:new', () => {
  it('tên sự kiện là notification:new', () => {
    expect(REALTIME_EVENTS.notificationNew).toBe('notification:new');
  });

  it('payload chính là thông báo vừa ghi (cùng hình dạng một phần tử danh sách)', () => {
    const payload = item('ORDER_NEW', { orderId: ORDER_ID });

    expect(notificationNewEventSchema.parse(payload)).toEqual(payload);
  });

  it('payload loại lạ rơi về UNKNOWN thay vì làm nổ trình xử lý sự kiện', () => {
    expect(notificationNewEventSchema.parse(item('PROMO_BLAST', {})).type).toBe(
      'UNKNOWN',
    );
  });

  it('payload hỏng (không phải object / thiếu id) bị từ chối', () => {
    expect(notificationNewEventSchema.safeParse(null).success).toBe(false);
    expect(notificationNewEventSchema.safeParse('x').success).toBe(false);
    expect(
      notificationNewEventSchema.safeParse({
        type: 'ORDER_NEW',
        data: { orderId: ORDER_ID },
      }).success,
    ).toBe(false);
  });
});

describe('khớp với DB', () => {
  const migrationSql = () => {
    const migrationsDir = join(
      __dirname,
      '..',
      '..',
      '..',
      'prisma',
      'migrations',
    );
    const folder = readdirSync(migrationsDir).find((name) =>
      name.endsWith('_add_notifications_table'),
    );
    expect(folder).toBeDefined();
    return readFileSync(
      join(migrationsDir, folder as string, 'migration.sql'),
      'utf8',
    );
  };

  it('NOTIFICATION_TYPE_MAX_LENGTH bằng cận trên của CHECK type (đổi một nơi mà quên nơi kia là test đỏ)', () => {
    const match = /char_length\("type"\)\s+BETWEEN\s+1\s+AND\s+(\d+)/.exec(
      migrationSql(),
    );

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(NOTIFICATION_TYPE_MAX_LENGTH);
  });

  it('CHECK kích thước data của DB bằng đúng 2 × NOTIFICATION_DATA_MAX_BYTES (jsonb::text dài hơn JSON gọn)', () => {
    const match = /octet_length\("data"::text\)\s*<=\s*(\d+)/.exec(
      migrationSql(),
    );

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(NOTIFICATION_DATA_MAX_BYTES * 2);
  });
});
