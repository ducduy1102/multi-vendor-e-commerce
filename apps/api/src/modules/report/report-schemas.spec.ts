import {
  ADMIN_AUDIT_TARGET_TYPES,
  ADMIN_REPORT_LIST_FILTERS,
  LIST_MAX_PAGE,
  REPORT_LIST_MAX_PAGE_SIZE,
  REPORT_NOTE_MAX_LENGTH,
  REPORT_REASON_CODES,
  REPORT_REASON_CODES_BY_TARGET,
  REPORT_RESOLUTION_ACTIONS,
  REPORT_RESOLUTION_ACTIONS_BY_TARGET,
  REPORT_RESOLUTION_NOTE_MAX_LENGTH,
  REPORT_SNAPSHOT_MAX_BYTES,
  REPORT_SNAPSHOT_SCHEMAS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  REVIEW_COMMENT_MAX_LENGTH,
  SERVER_ERROR_CODES,
  USER_NAME_MAX_LENGTH,
  adminReportDetailResponseSchema,
  adminReportListQuerySchema,
  adminReportListResponseSchema,
  adminReportSchema,
  createReportResponseSchema,
  createReportSchema,
  isReportActionAllowed,
  isReportReasonAllowedForTarget,
  parseReportSnapshot,
  reportActionRequiresNote,
  reportActionsFor,
  reportStatusForAction,
  resolveReportSchema,
  type ReportResolutionAction,
  type ReportTargetType,
} from '@ecommerce/types';

// Hợp đồng dùng chung của báo cáo vi phạm (packages/types/src/report.ts, Week11.md 5.1). packages/types không có test runner riêng —
// test ở đây (cùng precedent appeal-schemas.spec.ts). Phần "khớp với DB" (enum Prisma, CHECK, chỉ mục) được thêm ở bước 5.2 khi migration
// tồn tại. Ký tự đặc biệt dựng bằng String.fromCharCode để tệp nguồn không chứa ký tự điều khiển thật.
const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const BIDI_OVERRIDE = String.fromCharCode(0x202e);

const UUID = '0b7d9a52-3c1e-4f4d-8f27-6a1d5e9c2b10';

const issueMessages = (result: {
  success: boolean;
  error?: { issues: { message: string; path: (string | number)[] }[] };
}) => (result.error?.issues ?? []).map((issue) => issue.message);

describe('bảng loại đối tượng ↔ lý do', () => {
  it('bốn loại đối tượng, tập con của loại đối tượng nhật ký quản trị (xử lý báo cáo ghi nhật ký lên đúng loại)', () => {
    expect([...REPORT_TARGET_TYPES].sort()).toEqual([
      'CONVERSATION',
      'PRODUCT',
      'REVIEW',
      'SHOP',
    ]);
    for (const targetType of REPORT_TARGET_TYPES) {
      expect(ADMIN_AUDIT_TARGET_TYPES).toContain(targetType);
    }
  });

  it('trạng thái: OPEN rồi RESOLVED hoặc DISMISSED', () => {
    expect([...REPORT_STATUSES]).toEqual(['OPEN', 'RESOLVED', 'DISMISSED']);
    expect([...ADMIN_REPORT_LIST_FILTERS]).toEqual(['OPEN', 'CLOSED']);
  });

  it('mỗi loại chỉ dùng mã có trong danh sách chung, không trùng mã, luôn có OTHER và OTHER đứng cuối', () => {
    for (const targetType of REPORT_TARGET_TYPES) {
      const codes: readonly string[] =
        REPORT_REASON_CODES_BY_TARGET[targetType];
      expect(new Set(codes).size).toBe(codes.length);
      for (const code of codes) {
        expect(REPORT_REASON_CODES as readonly string[]).toContain(code);
      }
      expect(codes[codes.length - 1]).toBe('OTHER');
    }
  });

  it('không có mã mồ côi: mọi mã trong danh sách chung được ít nhất một loại dùng', () => {
    const used = new Set<string>(
      REPORT_TARGET_TYPES.flatMap((t) => [...REPORT_REASON_CODES_BY_TARGET[t]]),
    );
    expect([...REPORT_REASON_CODES].filter((c) => !used.has(c))).toEqual([]);
  });

  it('isReportReasonAllowedForTarget: đúng mã của loại thì qua, mã của loại khác thì không', () => {
    expect(isReportReasonAllowedForTarget('REVIEW', 'FAKE_REVIEW')).toBe(true);
    expect(isReportReasonAllowedForTarget('PRODUCT', 'FAKE_REVIEW')).toBe(
      false,
    );
    expect(isReportReasonAllowedForTarget('CONVERSATION', 'COUNTERFEIT')).toBe(
      false,
    );
    expect(isReportReasonAllowedForTarget('SHOP', 'COUNTERFEIT')).toBe(true);
    for (const targetType of REPORT_TARGET_TYPES) {
      expect(isReportReasonAllowedForTarget(targetType, 'OTHER')).toBe(true);
    }
  });
});

describe('body gửi báo cáo', () => {
  const valid = {
    targetType: 'REVIEW',
    targetId: UUID,
    reasonCode: 'SPAM',
  };

  it('hợp lệ không cần ghi chú; ghi chú rỗng hoặc chỉ khoảng trắng = chưa nhập (undefined, không phải chuỗi rỗng)', () => {
    expect(createReportSchema.safeParse(valid).success).toBe(true);
    for (const note of ['', '   ', '\n \r\n']) {
      const result = createReportSchema.safeParse({ ...valid, note });
      expect([note, result.success]).toEqual([note, true]);
      expect(result.data?.note).toBeUndefined();
    }
  });

  it('ghi chú được cắt khoảng trắng và chuẩn hoá CRLF/CR về LF', () => {
    expect(
      createReportSchema.parse({
        ...valid,
        note: '  dòng 1\r\ndòng 2\rdòng 3  ',
      }).note,
    ).toBe('dòng 1\ndòng 2\ndòng 3');
  });

  it('người báo, trạng thái, ảnh chụp, người xử lý và thời điểm KHÔNG đặt được từ client: field lạ bị bỏ khi parse', () => {
    const parsed = createReportSchema.parse({
      ...valid,
      note: 'ghi chú',
      reporterId: 'someone-else',
      status: 'RESOLVED',
      snapshot: { comment: 'giả' },
      resolvedById: 'admin-1',
      resolutionAction: 'HIDE_REVIEW',
      createdAt: '2020-01-01T00:00:00.000Z',
    });

    expect(Object.keys(parsed).sort()).toEqual([
      'note',
      'reasonCode',
      'targetId',
      'targetType',
    ]);
  });

  it.each([
    ['thiếu loại đối tượng', { ...valid, targetType: undefined }],
    ['loại đối tượng lạ', { ...valid, targetType: 'USER' }],
    ['thiếu id đối tượng', { ...valid, targetId: undefined }],
    ['id không phải UUID', { ...valid, targetId: 'not-a-uuid' }],
    ['id là số', { ...valid, targetId: 5 }],
  ])('%s bị từ chối', (_name, body) => {
    expect(createReportSchema.safeParse(body).success).toBe(false);
  });

  it('thiếu lý do ra key "bắt buộc", lý do lạ ra key "không hợp lệ"', () => {
    const missing = createReportSchema.safeParse({
      ...valid,
      reasonCode: undefined,
    });
    const unknown = createReportSchema.safeParse({
      ...valid,
      reasonCode: 'NOT_A_REASON',
    });

    expect(issueMessages(missing)).toEqual(['report.validationReasonRequired']);
    expect(issueMessages(unknown)).toEqual(['report.validationReasonInvalid']);
  });

  it('lý do phải thuộc đúng LOẠI đối tượng: FAKE_REVIEW cho sản phẩm bị từ chối, lỗi gắn đúng field `reasonCode`', () => {
    const result = createReportSchema.safeParse({
      ...valid,
      targetType: 'PRODUCT',
      reasonCode: 'FAKE_REVIEW',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['reasonCode'],
      message: 'report.validationReasonInvalid',
    });
  });

  it('mọi cặp (loại, lý do) trong bảng đều qua và mọi cặp ngoài bảng đều bị từ chối', () => {
    for (const targetType of REPORT_TARGET_TYPES) {
      for (const reasonCode of REPORT_REASON_CODES) {
        const allowed = isReportReasonAllowedForTarget(targetType, reasonCode);
        const result = createReportSchema.safeParse({
          targetType,
          targetId: UUID,
          reasonCode,
          note: 'mô tả',
        });
        expect([targetType, reasonCode, result.success]).toEqual([
          targetType,
          reasonCode,
          allowed,
        ]);
      }
    }
  });

  it('chọn OTHER thì BẮT BUỘC mô tả, lỗi gắn đúng field `note`; có mô tả thì qua', () => {
    for (const targetType of REPORT_TARGET_TYPES) {
      for (const note of [undefined, '', '   ']) {
        const missing = createReportSchema.safeParse({
          targetType,
          targetId: UUID,
          reasonCode: 'OTHER',
          note,
        });
        expect(missing.success).toBe(false);
        expect(missing.error?.issues[0]).toMatchObject({
          path: ['note'],
          message: 'report.validationNoteRequired',
        });
      }
      expect(
        createReportSchema.safeParse({
          targetType,
          targetId: UUID,
          reasonCode: 'OTHER',
          note: 'Quảng cáo dịch vụ ngoài sàn',
        }).success,
      ).toBe(true);
    }
  });

  it('ghi chú đúng cận 500 ký tự thì qua, 501 thì bị từ chối với key "quá dài"; cận tính SAU khi cắt khoảng trắng', () => {
    expect(
      createReportSchema.safeParse({
        ...valid,
        note: 'a'.repeat(REPORT_NOTE_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      createReportSchema.safeParse({
        ...valid,
        note: `   ${'a'.repeat(REPORT_NOTE_MAX_LENGTH)}   `,
      }).success,
    ).toBe(true);

    const tooLong = createReportSchema.safeParse({
      ...valid,
      note: 'a'.repeat(REPORT_NOTE_MAX_LENGTH + 1),
    });
    expect(tooLong.success).toBe(false);
    expect(issueMessages(tooLong)).toEqual(['report.validationNoteTooLong']);
  });

  it.each([
    ['NUL', `abc${NUL}def`],
    ['tab', `abc${TAB}def`],
    ['bidi-override', `abc${BIDI_OVERRIDE}def`],
  ])(
    'ghi chú có ký tự không an toàn (%s) bị từ chối với key "không an toàn"',
    (_name, note) => {
      const result = createReportSchema.safeParse({ ...valid, note });

      expect(result.success).toBe(false);
      expect(issueMessages(result)).toEqual(['report.validationNoteUnsafe']);
    },
  );

  it('không chặn <, > và dấu nháy: ghi chú hiển thị như chữ (React tự escape)', () => {
    const note = 'Shop bán "áo < 5 triệu" và <b>hàng giả</b>';

    expect(createReportSchema.parse({ ...valid, note }).note).toBe(note);
  });
});

describe('bảng loại đối tượng ↔ hành động xử lý', () => {
  it('mỗi loại chỉ dùng hành động có trong danh sách chung và luôn có DISMISS', () => {
    for (const targetType of REPORT_TARGET_TYPES) {
      const actions: readonly string[] =
        REPORT_RESOLUTION_ACTIONS_BY_TARGET[targetType];
      for (const action of actions) {
        expect(REPORT_RESOLUTION_ACTIONS as readonly string[]).toContain(
          action,
        );
      }
      expect(actions).toContain('DISMISS');
    }
  });

  it('không có hành động mồ côi: mọi hành động được ít nhất một loại dùng', () => {
    const used = new Set<string>(
      REPORT_TARGET_TYPES.flatMap((t) => [
        ...REPORT_RESOLUTION_ACTIONS_BY_TARGET[t],
      ]),
    );
    expect([...REPORT_RESOLUTION_ACTIONS].filter((a) => !used.has(a))).toEqual(
      [],
    );
  });

  it.each<[ReportTargetType, ReportResolutionAction[]]>([
    ['REVIEW', ['HIDE_REVIEW', 'DISMISS']],
    ['SHOP', ['SUSPEND_SHOP', 'DISMISS']],
    ['PRODUCT', ['TAKE_DOWN_PRODUCT', 'DISMISS']],
  ])(
    '%s: đúng hành động của loại, hành động của loại khác bị từ chối',
    (targetType, expected) => {
      expect(reportActionsFor(targetType)).toEqual(expected);
      for (const action of REPORT_RESOLUTION_ACTIONS) {
        expect([action, isReportActionAllowed(targetType, action)]).toEqual([
          action,
          expected.includes(action),
        ]);
      }
    },
  );

  it('hội thoại: chủ shop báo (bên bị báo là người mua) có thêm BLOCK_BUYER; người mua báo (bên bị báo là chủ shop) thì không', () => {
    expect(reportActionsFor('CONVERSATION', 'SHOP')).toEqual([
      'SUSPEND_REPORTED_USER',
      'BLOCK_BUYER',
      'DISMISS',
    ]);
    expect(reportActionsFor('CONVERSATION', 'BUYER')).toEqual([
      'SUSPEND_REPORTED_USER',
      'DISMISS',
    ]);
    expect(isReportActionAllowed('CONVERSATION', 'BLOCK_BUYER', 'BUYER')).toBe(
      false,
    );
  });

  it('thiếu vai người báo thì BLOCK_BUYER KHÔNG được coi là hợp lệ (mặc định an toàn)', () => {
    expect(isReportActionAllowed('CONVERSATION', 'BLOCK_BUYER')).toBe(false);
    expect(reportActionsFor('CONVERSATION')).toEqual([
      'SUSPEND_REPORTED_USER',
      'DISMISS',
    ]);
  });

  it('BLOCK_BUYER không dùng được cho loại khác dù truyền vai SHOP', () => {
    for (const targetType of ['REVIEW', 'SHOP', 'PRODUCT'] as const) {
      expect(isReportActionAllowed(targetType, 'BLOCK_BUYER', 'SHOP')).toBe(
        false,
      );
    }
  });

  it('DISMISS ⇒ DISMISSED, mọi hành động khác ⇒ RESOLVED', () => {
    expect(reportStatusForAction('DISMISS')).toBe('DISMISSED');
    for (const action of REPORT_RESOLUTION_ACTIONS.filter(
      (a) => a !== 'DISMISS',
    )) {
      expect([action, reportStatusForAction(action)]).toEqual([
        action,
        'RESOLVED',
      ]);
    }
  });

  it('mọi hành động trừ DISMISS đều đòi ghi chú', () => {
    expect(reportActionRequiresNote('DISMISS')).toBe(false);
    for (const action of REPORT_RESOLUTION_ACTIONS.filter(
      (a) => a !== 'DISMISS',
    )) {
      expect([action, reportActionRequiresNote(action)]).toEqual([
        action,
        true,
      ]);
    }
  });
});

describe('body xử lý báo cáo', () => {
  it('bỏ qua (DISMISS) không cần ghi chú; ghi chú tuỳ chọn khi bỏ qua', () => {
    expect(resolveReportSchema.safeParse({ action: 'DISMISS' }).success).toBe(
      true,
    );
    expect(
      resolveReportSchema.parse({ action: 'DISMISS', note: '  Không vi phạm ' })
        .note,
    ).toBe('Không vi phạm');
  });

  it.each(REPORT_RESOLUTION_ACTIONS.filter((a) => a !== 'DISMISS'))(
    '%s BẮT BUỘC có ghi chú, lỗi gắn đúng field `note` với key của khu Admin',
    (action) => {
      for (const note of [undefined, '', '   ']) {
        const result = resolveReportSchema.safeParse({ action, note });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]).toMatchObject({
          path: ['note'],
          message: 'admin.validationReportNoteRequired',
        });
      }
      expect(
        resolveReportSchema.safeParse({ action, note: 'Bán hàng giả' }).success,
      ).toBe(true);
    },
  );

  it('ghi chú có nội dung vẫn qua đủ luật: quá 500 ký tự / ký tự không an toàn bị từ chối với key riêng', () => {
    const tooLong = resolveReportSchema.safeParse({
      action: 'DISMISS',
      note: 'a'.repeat(REPORT_RESOLUTION_NOTE_MAX_LENGTH + 1),
    });
    const unsafe = resolveReportSchema.safeParse({
      action: 'DISMISS',
      note: `lý do${NUL}`,
    });

    expect(issueMessages(tooLong)).toEqual([
      'admin.validationReportNoteTooLong',
    ]);
    expect(issueMessages(unsafe)).toEqual(['admin.validationReportNoteUnsafe']);
    expect(
      resolveReportSchema.safeParse({
        action: 'HIDE_REVIEW',
        note: 'a'.repeat(REPORT_RESOLUTION_NOTE_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });

  it.each([
    ['hành động lạ', { action: 'DELETE_EVERYTHING', note: 'x' }],
    ['thiếu hành động', { note: 'x' }],
  ])('%s bị từ chối', (_name, body) => {
    expect(resolveReportSchema.safeParse(body).success).toBe(false);
  });

  it('người xử lý, đối tượng và thời điểm KHÔNG đặt được từ client: field lạ bị bỏ khi parse', () => {
    const parsed = resolveReportSchema.parse({
      action: 'DISMISS',
      resolvedById: 'someone-else',
      targetType: 'SHOP',
      status: 'OPEN',
      resolvedAt: '2020-01-01T00:00:00.000Z',
    });

    expect(Object.keys(parsed)).toEqual(['action']);
  });
});

describe('query hàng đợi của Admin', () => {
  it('mặc định OPEN, mọi loại, page=1, limit=20; chuỗi số từ URL được coerce', () => {
    expect(adminReportListQuerySchema.parse({})).toEqual({
      status: 'OPEN',
      page: 1,
      limit: 20,
    });
    expect(
      adminReportListQuerySchema.parse({
        status: 'CLOSED',
        targetType: 'SHOP',
        page: '3',
        limit: '50',
      }),
    ).toEqual({ status: 'CLOSED', targetType: 'SHOP', page: 3, limit: 50 });
  });

  it('trạng thái và loại lạ bị từ chối (RESOLVED/DISMISSED riêng không phải bộ lọc: tab "đã xử lý" gộp cả hai)', () => {
    for (const query of [
      { status: 'ALL' },
      { status: 'RESOLVED' },
      { targetType: 'USER' },
    ]) {
      expect([
        query,
        adminReportListQuerySchema.safeParse(query).success,
      ]).toEqual([query, false]);
    }
  });

  it('limit tối đa 50 và page có trần LIST_MAX_PAGE', () => {
    expect(
      adminReportListQuerySchema.safeParse({
        limit: String(REPORT_LIST_MAX_PAGE_SIZE),
      }).success,
    ).toBe(true);
    expect(
      adminReportListQuerySchema.safeParse({
        limit: String(REPORT_LIST_MAX_PAGE_SIZE + 1),
      }).success,
    ).toBe(false);
    expect(
      adminReportListQuerySchema.safeParse({ page: String(LIST_MAX_PAGE) })
        .success,
    ).toBe(true);
    for (const page of [String(LIST_MAX_PAGE + 1), '1e21', '0', '-1', 'abc']) {
      expect([
        page,
        adminReportListQuerySchema.safeParse({ page }).success,
      ]).toEqual([page, false]);
    }
  });
});

describe('ảnh chụp (snapshot)', () => {
  const snapshots = {
    REVIEW: {
      productName: 'Áo thun cotton',
      productSlug: 'ao-thun-cotton',
      rating: 1,
      comment: 'Hàng giả, shop lừa đảo',
      authorName: 'Nguyễn Văn A',
    },
    CONVERSATION: {
      shopName: 'Shop A',
      buyerName: 'Trần B',
      reporterRole: 'SHOP',
    },
    SHOP: { name: 'Shop A', slug: 'shop-a' },
    PRODUCT: { name: 'Áo thun', slug: 'ao-thun', shopName: 'Shop A' },
  } as const;

  it.each(REPORT_TARGET_TYPES)(
    '%s: ảnh chụp đúng hình dạng thì qua nguyên vẹn',
    (targetType) => {
      expect(parseReportSnapshot(targetType, snapshots[targetType])).toEqual(
        snapshots[targetType],
      );
    },
  );

  it('đánh giá chỉ có sao (không lời) lưu comment null', () => {
    expect(
      parseReportSnapshot('REVIEW', { ...snapshots.REVIEW, comment: null })
        .comment,
    ).toBeNull();
  });

  it('ảnh chụp của HỘI THOẠI chỉ có tên hai bên và vai người báo: KHÔNG có chỗ cho nội dung tin nhắn (đường đọc chat duy nhất là có nhật ký truy cập)', () => {
    expect(
      Object.keys(REPORT_SNAPSHOT_SCHEMAS.CONVERSATION.shape).sort(),
    ).toEqual(['buyerName', 'reporterRole', 'shopName']);
    for (const extra of [
      { content: 'nội dung tin nhắn' },
      { messages: [{ content: 'x' }] },
      { lastMessage: 'x' },
      { buyerEmail: 'buyer@example.com' },
      { buyerId: UUID },
    ]) {
      expect(() =>
        parseReportSnapshot('CONVERSATION', {
          ...snapshots.CONVERSATION,
          ...extra,
        }),
      ).toThrow();
    }
  });

  it('phía GHI từ chối mọi field thừa (strict) ở mọi loại — một lỗi của nơi dựng ảnh chụp không ghi thêm trường vào DB', () => {
    for (const targetType of REPORT_TARGET_TYPES) {
      expect(() =>
        parseReportSnapshot(targetType, {
          ...snapshots[targetType],
          reporterEmail: 'a@b.c',
        }),
      ).toThrow();
    }
  });

  it('sai hình dạng của loại (ảnh chụp shop cho báo cáo đánh giá) và giá trị sai kiểu bị từ chối', () => {
    expect(() => parseReportSnapshot('REVIEW', snapshots.SHOP)).toThrow();
    expect(() =>
      parseReportSnapshot('REVIEW', { ...snapshots.REVIEW, rating: 6 }),
    ).toThrow();
    expect(() =>
      parseReportSnapshot('REVIEW', { ...snapshots.REVIEW, rating: 0 }),
    ).toThrow();
    expect(() =>
      parseReportSnapshot('REVIEW', { ...snapshots.REVIEW, rating: 3.5 }),
    ).toThrow();
    expect(() =>
      parseReportSnapshot('SHOP', { ...snapshots.SHOP, name: '' }),
    ).toThrow();
    expect(() =>
      parseReportSnapshot('CONVERSATION', {
        ...snapshots.CONVERSATION,
        reporterRole: 'ADMIN',
      }),
    ).toThrow();
    expect(() => parseReportSnapshot('SHOP', null)).toThrow();
  });

  it('vượt REPORT_SNAPSHOT_MAX_BYTES bị từ chối; thông điệp lỗi không chứa giá trị (đánh giá là dữ liệu riêng tư)', () => {
    const canary = 'CANARY-DANH-GIA-RIENG-TU';
    let thrown: unknown;
    try {
      parseReportSnapshot('REVIEW', {
        ...snapshots.REVIEW,
        comment: `${canary}${'a'.repeat(REPORT_SNAPSHOT_MAX_BYTES)}`,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const text = `${(thrown as Error).message}\n${(thrown as Error).stack ?? ''}`;
    expect(text).not.toContain(canary);
  });

  it('ca xấu nhất theo giới hạn thật vẫn VỪA 4 KB: đánh giá 1.000 ký tự 3 byte + tên tác giả 100 + tên sản phẩm cắt ở 150 + slug 150', () => {
    const worst = {
      productName: 'ệ'.repeat(150),
      productSlug: 'a'.repeat(150),
      rating: 5,
      comment: 'ệ'.repeat(REVIEW_COMMENT_MAX_LENGTH),
      authorName: 'ệ'.repeat(USER_NAME_MAX_LENGTH),
    };

    expect(
      Buffer.byteLength(JSON.stringify(worst), 'utf8'),
    ).toBeLessThanOrEqual(REPORT_SNAPSHOT_MAX_BYTES);
    expect(() => parseReportSnapshot('REVIEW', worst)).not.toThrow();
  });
});

describe('response (allowlist)', () => {
  const base = {
    id: 'r1',
    targetId: UUID,
    status: 'OPEN',
    reasonCode: 'FAKE_REVIEW',
    note: 'Người này chưa mua hàng',
    reporter: { name: 'Người báo', email: 'reporter@example.com' },
    createdAt: '2026-10-30T08:00:00.000Z',
    resolution: null,
  };
  const review = {
    ...base,
    targetType: 'REVIEW',
    snapshot: {
      productName: 'Áo thun',
      productSlug: 'ao-thun',
      rating: 1,
      comment: 'Tệ',
      authorName: 'Tác giả',
    },
  };

  it('báo cáo của Admin phân biệt theo targetType: ảnh chụp sai loại bị từ chối', () => {
    expect(adminReportSchema.safeParse(review).success).toBe(true);
    expect(
      adminReportSchema.safeParse({
        ...review,
        snapshot: { name: 'Shop A', slug: 'shop-a' },
      }).success,
    ).toBe(false);
    expect(
      adminReportSchema.safeParse({ ...review, targetType: 'USER' }).success,
    ).toBe(false);
  });

  it('thu hẹp kiểu theo targetType: ảnh chụp của từng loại parse đúng', () => {
    const shop = adminReportSchema.parse({
      ...base,
      targetType: 'SHOP',
      snapshot: { name: 'Shop A', slug: 'shop-a' },
    });
    const conversation = adminReportSchema.parse({
      ...base,
      targetType: 'CONVERSATION',
      snapshot: { shopName: 'Shop A', buyerName: 'B', reporterRole: 'BUYER' },
    });

    expect(shop.targetType === 'SHOP' && shop.snapshot.slug).toBe('shop-a');
    expect(
      conversation.targetType === 'CONVERSATION' &&
        conversation.snapshot.reporterRole,
    ).toBe('BUYER');
  });

  it('Admin thấy tên + email người báo nhưng KHÔNG thấy id, SĐT hay địa chỉ của họ; field lạ bị bỏ khi parse', () => {
    const parsed = adminReportSchema.parse({
      ...review,
      reporterId: 'u1',
      reporter: {
        ...base.reporter,
        id: 'u1',
        phone: '0901234567',
        address: 'Hà Nội',
      },
    });

    expect(JSON.stringify(parsed)).not.toMatch(
      /0901234567|Hà Nội|reporterId|"id":"u1"/,
    );
    expect(Object.keys(parsed.reporter).sort()).toEqual(['email', 'name']);
  });

  it('kết quả xử lý có người xử lý theo TÊN (không id); báo cáo còn mở có resolution null', () => {
    const resolved = adminReportSchema.parse({
      ...review,
      status: 'RESOLVED',
      resolution: {
        action: 'HIDE_REVIEW',
        note: 'Vi phạm',
        resolvedByName: 'Quản trị viên',
        resolvedById: 'admin-1',
        resolvedAt: '2026-10-30T09:00:00.000Z',
      },
    });

    expect(resolved.resolution).toEqual({
      action: 'HIDE_REVIEW',
      note: 'Vi phạm',
      resolvedByName: 'Quản trị viên',
      resolvedAt: '2026-10-30T09:00:00.000Z',
    });
    expect(adminReportSchema.parse(review).resolution).toBeNull();
  });

  it('mã lý do và hành động xử lý là chuỗi thường: mã lạ do BE thêm sau không làm hỏng cả trang', () => {
    expect(
      adminReportSchema.safeParse({
        ...review,
        reasonCode: 'SOME_FUTURE_REASON',
        status: 'RESOLVED',
        resolution: {
          action: 'SOME_FUTURE_ACTION',
          note: null,
          resolvedByName: null,
          resolvedAt: '2026-10-30T09:00:00.000Z',
        },
      }).success,
    ).toBe(true);
  });

  it('danh sách và chi tiết dùng cùng hình dạng một báo cáo', () => {
    expect(
      adminReportListResponseSchema.safeParse({
        items: [review],
        total: 1,
        page: 1,
        limit: 20,
      }).success,
    ).toBe(true);
    expect(
      adminReportDetailResponseSchema.safeParse({ report: review }).success,
    ).toBe(true);
    expect(
      adminReportListResponseSchema.safeParse({ items: [review] }).success,
    ).toBe(false);
  });

  it('người báo chỉ nhận biên nhận tối thiểu: không echo lại ghi chú, ảnh chụp hay thông tin đối tượng', () => {
    const parsed = createReportResponseSchema.parse({
      report: {
        id: 'r1',
        targetType: 'REVIEW',
        status: 'OPEN',
        createdAt: '2026-10-30T08:00:00.000Z',
        note: 'ghi chú',
        snapshot: { comment: 'x' },
        targetId: UUID,
        reasonCode: 'SPAM',
      },
    });

    expect(Object.keys(parsed.report).sort()).toEqual([
      'createdAt',
      'id',
      'status',
      'targetType',
    ]);
  });
});

describe('mã lỗi', () => {
  it.each([
    'REPORT_ALREADY_OPEN',
    'REPORT_LIMIT_REACHED',
    'REPORT_TARGET_NOT_FOUND',
    'REPORT_OWN_CONTENT',
    'REPORT_NOT_FOUND',
    'REPORT_ALREADY_CLOSED',
    'REPORT_ACTION_NOT_ALLOWED',
  ])('%s nằm trong danh sách mã lỗi BE trả', (errorCode) => {
    expect(SERVER_ERROR_CODES).toContain(errorCode);
  });
});
