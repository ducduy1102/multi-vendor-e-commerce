import { toNotificationDto, type NotificationRow } from './notification.mapper';

// Hàng DB → phần tử response / payload real-time (Week10.md 7.3; bên đọc ở 7.6 dùng lại). Điểm quan trọng: dữ liệu chưa
// được kiểm KHÔNG bao giờ ra khỏi API — loại lạ hoặc hình dạng sai rơi về UNKNOWN với data rỗng.
const ID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ORDER_ID = '2c6f6d3a-8d4b-4f55-9a52-0d9a2b6a7c11';
const CREATED = new Date('2030-01-01T10:00:00.000Z');
const READ = new Date('2030-01-02T08:30:00.000Z');

const row = (overrides: Partial<NotificationRow> = {}): NotificationRow => ({
  id: ID,
  type: 'ORDER_NEW',
  data: { orderId: ORDER_ID },
  readAt: null,
  createdAt: CREATED,
  ...overrides,
});

describe('toNotificationDto', () => {
  it('hàng chưa đọc ⇒ readAt null, mốc tạo là chuỗi ISO', () => {
    expect(toNotificationDto(row())).toEqual({
      id: ID,
      type: 'ORDER_NEW',
      data: { orderId: ORDER_ID },
      readAt: null,
      createdAt: '2030-01-01T10:00:00.000Z',
    });
  });

  it('hàng đã đọc ⇒ readAt là chuỗi ISO của mốc đọc (không bị mất)', () => {
    expect(toNotificationDto(row({ readAt: READ })).readAt).toBe(
      '2030-01-02T08:30:00.000Z',
    );
  });

  it('mọi loại đã biết giữ nguyên loại và dữ liệu', () => {
    const dto = toNotificationDto(
      row({
        type: 'ORDER_CANCELLED',
        data: {
          orderId: ORDER_ID,
          audience: 'BUYER',
          by: 'SELLER',
          shopName: 'Shop',
          reason: 'Hết hàng',
        },
      }),
    );

    expect(dto.type).toBe('ORDER_CANCELLED');
    expect(dto.data).toEqual({
      orderId: ORDER_ID,
      audience: 'BUYER',
      by: 'SELLER',
      shopName: 'Shop',
      reason: 'Hết hàng',
    });
  });

  it('loại không có trong danh sách (hàng của bản mới hơn / ghi tay) ⇒ UNKNOWN, data rỗng, KHÔNG chuyển tiếp dữ liệu lạ', () => {
    const dto = toNotificationDto(
      row({
        type: 'PROMO_BLAST',
        data: { title: 'Giảm 90%', url: 'https://evil.example' },
        readAt: READ,
      }),
    );

    expect(dto).toEqual({
      id: ID,
      type: 'UNKNOWN',
      data: {},
      readAt: '2030-01-02T08:30:00.000Z',
      createdAt: '2030-01-01T10:00:00.000Z',
    });
    expect(JSON.stringify(dto)).not.toContain('evil.example');
  });

  it.each([
    ['dữ liệu sai hình dạng', { orderId: 'không-phải-uuid' }],
    ['dữ liệu có khoá lạ', { orderId: ORDER_ID, url: 'https://evil.example' }],
    ['dữ liệu là mảng', []],
    ['dữ liệu null', null],
    ['dữ liệu là chuỗi', 'ORDER_NEW'],
  ])('loại đã biết nhưng %s ⇒ UNKNOWN thay vì ném lỗi', (_name, data) => {
    const dto = toNotificationDto(row({ data }));

    expect(dto.type).toBe('UNKNOWN');
    expect(dto.data).toEqual({});
  });
});
