import {
  buildRefundRequest,
  checkRefundParams,
  checkRefundResponseSignature,
  interpretRefundResponse,
  MANUAL_REFUND_HINT,
  parseRefundResponse,
  type RefundableParams,
} from './vnpay-refund';

const SECRET = 'SECRETKEY123456789';

// Mọi chữ ký kỳ vọng dưới đây tính ĐỘC LẬP bằng `crypto.createHmac('sha512', SECRET)` trên chuỗi nối `|` viết tay
// (không dùng hàm của dự án). Hình dạng phản hồi lấy từ lần chạy thật trên sandbox VNPay (Week9.md 2.12): thành
// công `00`/status `05`, từ chối `94 Too many refund count (>0)`, `91 Transaction not found`, và trùng mã yêu
// cầu `94 Request is duplicated` (KHÔNG có chữ ký).
const REQUEST_DATA =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90|2.1.0|refund|TESTCODE|03|ABC123|10000000|14000001|20260927103025|system|20260927110000|127.0.0.1|Hoan tien don hang ABC123';
const REQUEST_HASH =
  '341037dea19b4404b331bd46de96b6b3f819df68575e0eeb3f0430e764d171ef9d6e130a49d33e14df9f976b2c57d8f452f9ebc739f093a0f81e3d6891b9cc56';
const REQUEST_FULL_HASH =
  'e108993c6f23062a4f5e6c7c406dea4c47a46bf6b3b3c024c0bbdac1a810df70b00255cf694c1e5b8ca9668a35a150fedd826128f9258b50076f2d6c0674befd';

const OK_RESPONSE = {
  vnp_ResponseId: 'resp0001',
  vnp_Command: 'refund',
  vnp_ResponseCode: '00',
  vnp_Message: 'Refund success',
  vnp_TmnCode: 'TESTCODE',
  vnp_TxnRef: 'ABC123',
  vnp_Amount: '10000000',
  vnp_BankCode: 'NCB',
  vnp_PayDate: '20260927110005',
  vnp_TransactionNo: '14000099',
  vnp_TransactionType: '03',
  vnp_TransactionStatus: '05',
  vnp_OrderInfo: 'Hoan tien don hang ABC123',
  vnp_SecureHash:
    '145a09aa4ba97b1dba9217d63b7896f7919b13d40482095f53f797fad9e98bd7623320f56080e415d436f7e1cb7b941d9c36ff8c21f9cda6b72ab88bbdeaca4b',
};

const TOO_MANY_RESPONSE = {
  vnp_ResponseId: 'resp0002',
  vnp_Command: 'refund',
  vnp_ResponseCode: '94',
  vnp_Message: 'Too many refund count (>0)',
  vnp_TmnCode: 'TESTCODE',
  vnp_TxnRef: 'ABC123',
  vnp_Amount: '10000000',
  vnp_BankCode: 'NCB',
  vnp_OrderInfo: 'Hoan tien don hang ABC123',
  vnp_SecureHash:
    'a94ed3fe9c1ddfbd34c13f6226bfb3c76530a9746302e4b33df53accc8eb6e81b08d1a1214afeab92238b363a8464082091039ba3328b3b08fdf724a79a6e655',
};

const NOT_FOUND_RESPONSE = {
  vnp_ResponseId: 'resp0003',
  vnp_Command: 'refund',
  vnp_ResponseCode: '91',
  vnp_Message: 'Transaction not found',
  vnp_TmnCode: 'TESTCODE',
  vnp_TxnRef: 'ABC123',
  vnp_Amount: '10000000',
  vnp_SecureHash:
    '189aafff0c0badb2a0328ae39101b0c281e86f52a1ffa3b545d2640820015bfaeaeeccf05f088f8f598ddac8426fb5a8895602adc4c906d40898c764e8df1389',
};

const DUPLICATE_RESPONSE = {
  vnp_ResponseCode: '94',
  vnp_Message: 'Request is duplicated',
};

const baseParams: RefundableParams = {
  refundRef: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  txnRef: 'ABC123',
  gatewayTransactionId: '14000001',
  gatewayPaidAt: new Date('2026-09-27T03:30:25Z'),
  amountVnd: 100_000,
  paymentAmountVnd: 250_000,
  reason: 'Order refund',
};
const NOW = new Date('2026-09-27T04:00:00Z');

function interpret(
  body: unknown,
  signature: 'valid' | 'invalid' | 'absent' = 'valid',
) {
  return interpretRefundResponse(parseRefundResponse(body), signature);
}

describe('checkRefundParams', () => {
  it('đủ điều kiện ⇒ ok, trả lại tham số đã thu hẹp kiểu', () => {
    const result = checkRefundParams(baseParams);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.gatewayTransactionId).toBe('14000001');
      expect(result.params.gatewayPaidAt).toEqual(baseParams.gatewayPaidAt);
    }
  });

  it.each([
    ['thiếu mã giao dịch của cổng', { gatewayTransactionId: null }],
    ['thiếu mốc cổng ghi nhận (thanh toán cũ)', { gatewayPaidAt: null }],
  ])('%s ⇒ từ chối kèm hướng dẫn hoàn thủ công', (_label, override) => {
    const result = checkRefundParams({ ...baseParams, ...override });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(MANUAL_REFUND_HINT);
  });

  it.each([
    ['refundRef có gạch ngang', { refundRef: 'a1b2-c3d4' }],
    ['refundRef dài hơn 32', { refundRef: 'a'.repeat(33) }],
    ['refundRef rỗng', { refundRef: '' }],
    ['txnRef có ký tự lạ', { txnRef: 'AB C|1' }],
    ['txnRef dài hơn 100', { txnRef: 'A'.repeat(101) }],
    ['số tiền hoàn bằng 0', { amountVnd: 0 }],
    ['số tiền hoàn âm', { amountVnd: -1 }],
    ['số tiền hoàn lẻ', { amountVnd: 1000.5 }],
    ['hoàn quá số đã thanh toán', { amountVnd: 250_001 }],
    ['số tiền thanh toán lẻ', { paymentAmountVnd: 250_000.5 }],
  ])('%s ⇒ từ chối, không gọi cổng', (_label, override) => {
    const result = checkRefundParams({ ...baseParams, ...override });

    expect(result.ok).toBe(false);
  });

  it('cho phép hoàn đúng bằng số đã thanh toán', () => {
    expect(checkRefundParams({ ...baseParams, amountVnd: 250_000 }).ok).toBe(
      true,
    );
  });
});

describe('buildRefundRequest', () => {
  const build = (params: RefundableParams = baseParams) =>
    buildRefundRequest({
      tmnCode: 'TESTCODE',
      hashSecret: SECRET,
      params,
      now: NOW,
      serverIp: '127.0.0.1',
    });

  it('vector cố định: đúng từng trường và chữ ký (hoàn một phần ⇒ loại 03, tiền ×100, giờ GMT+7)', () => {
    expect(build()).toEqual({
      vnp_RequestId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      vnp_Version: '2.1.0',
      vnp_Command: 'refund',
      vnp_TmnCode: 'TESTCODE',
      vnp_TransactionType: '03',
      vnp_TxnRef: 'ABC123',
      vnp_Amount: '10000000',
      vnp_TransactionNo: '14000001',
      vnp_TransactionDate: '20260927103025',
      vnp_CreateBy: 'system',
      vnp_CreateDate: '20260927110000',
      vnp_IpAddr: '127.0.0.1',
      vnp_OrderInfo: 'Hoan tien don hang ABC123',
      vnp_SecureHash: REQUEST_HASH,
    });
    // Chuỗi ký là các GIÁ TRỊ THÔ nối `|` theo thứ tự tài liệu — không phải query string đã mã hoá.
    expect(REQUEST_DATA.split('|')).toHaveLength(13);
  });

  it('hoàn toàn bộ (số hoàn = số đã thanh toán) ⇒ loại 02', () => {
    const request = build({ ...baseParams, amountVnd: 250_000 });

    expect(request.vnp_TransactionType).toBe('02');
    expect(request.vnp_Amount).toBe('25000000');
    expect(request.vnp_SecureHash).toBe(REQUEST_FULL_HASH);
  });

  it('mã yêu cầu lấy đúng refundRef ổn định (nền tảng chống hoàn trùng khi thử lại)', () => {
    expect(build().vnp_RequestId).toBe(baseParams.refundRef);
    expect(build().vnp_SecureHash).toBe(build().vnp_SecureHash);
  });

  it('đổi bất kỳ trường nào trong chuỗi ký thì chữ ký đổi', () => {
    const original = build().vnp_SecureHash;

    expect(build({ ...baseParams, txnRef: 'ABC124' }).vnp_SecureHash).not.toBe(
      original,
    );
    expect(
      build({ ...baseParams, gatewayTransactionId: '14000002' }).vnp_SecureHash,
    ).not.toBe(original);
    expect(
      build({ ...baseParams, gatewayPaidAt: new Date('2026-09-27T03:30:26Z') })
        .vnp_SecureHash,
    ).not.toBe(original);
  });

  it('vnp_OrderInfo không dấu và không chứa `|` (ký tự nối của chuỗi ký)', () => {
    const info = build().vnp_OrderInfo;

    expect(info).toMatch(/^[A-Za-z0-9 ]+$/);
    expect(info).not.toContain('|');
  });

  it('chữ ký không phải khoá: body không chứa hashSecret', () => {
    expect(JSON.stringify(build())).not.toContain(SECRET);
  });
});

describe('parseRefundResponse', () => {
  it('đọc phản hồi hợp lệ; số được quy về chuỗi (để ghép chuỗi ký đúng cách VNPay ghép)', () => {
    const parsed = parseRefundResponse({
      ...OK_RESPONSE,
      vnp_Amount: 10000000,
      vnp_TransactionNo: 14000099,
    });

    expect(parsed.vnp_Amount).toBe('10000000');
    expect(parsed.vnp_TransactionNo).toBe('14000099');
    expect(parsed.vnp_ResponseCode).toBe('00');
  });

  it('phản hồi lỗi chỉ có vài trường vẫn đọc được', () => {
    const parsed = parseRefundResponse(DUPLICATE_RESPONSE);

    expect(parsed.vnp_ResponseCode).toBe('94');
    expect(parsed.vnp_SecureHash).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['chuỗi', 'ok'],
    ['mảng', []],
    ['thiếu vnp_ResponseCode', { vnp_Message: 'x' }],
  ])('%s ⇒ ném lỗi (không hiểu thì không kết luận gì)', (_label, body) => {
    expect(() => parseRefundResponse(body)).toThrow(
      'VNPay refund response could not be understood',
    );
  });
});

describe('checkRefundResponseSignature', () => {
  it('chữ ký đúng (vector cố định, đủ 13 trường)', () => {
    expect(
      checkRefundResponseSignature(parseRefundResponse(OK_RESPONSE), SECRET),
    ).toBe('valid');
  });

  it('phản hồi từ chối thiếu nhiều trường: trường vắng nối thành chuỗi rỗng (đúng cách VNPay ký)', () => {
    expect(
      checkRefundResponseSignature(
        parseRefundResponse(TOO_MANY_RESPONSE),
        SECRET,
      ),
    ).toBe('valid');
    expect(
      checkRefundResponseSignature(
        parseRefundResponse(NOT_FOUND_RESPONSE),
        SECRET,
      ),
    ).toBe('valid');
  });

  it('chữ ký viết HOA vẫn hợp lệ', () => {
    const parsed = parseRefundResponse({
      ...OK_RESPONSE,
      vnp_SecureHash: OK_RESPONSE.vnp_SecureHash.toUpperCase(),
    });

    expect(checkRefundResponseSignature(parsed, SECRET)).toBe('valid');
  });

  it.each([
    ['sửa mã phản hồi', { vnp_ResponseCode: '00', vnp_Message: 'Refund fail' }],
    ['sửa số tiền', { vnp_Amount: '99999999' }],
    ['sửa trạng thái', { vnp_TransactionStatus: '00' }],
    ['sửa mã giao dịch hoàn', { vnp_TransactionNo: '1' }],
    ['chữ ký ngắn bất thường', { vnp_SecureHash: 'abc' }],
  ])('%s ⇒ invalid', (_label, override) => {
    const parsed = parseRefundResponse({ ...OK_RESPONSE, ...override });

    expect(checkRefundResponseSignature(parsed, SECRET)).toBe('invalid');
  });

  it('sai khoá ⇒ invalid', () => {
    expect(
      checkRefundResponseSignature(
        parseRefundResponse(OK_RESPONSE),
        'ANOTHER-SECRET',
      ),
    ).toBe('invalid');
  });

  it('không có vnp_SecureHash ⇒ absent (không phải invalid)', () => {
    expect(
      checkRefundResponseSignature(
        parseRefundResponse(DUPLICATE_RESPONSE),
        SECRET,
      ),
    ).toBe('absent');
  });
});

describe('interpretRefundResponse', () => {
  describe('cổng đã NHẬN yêu cầu hoàn (vnp_ResponseCode 00) ⇒ SUCCESS', () => {
    it.each(['00', '05', '06'])(
      'vnp_TransactionStatus %s ⇒ SUCCESS, mã hoàn = vnp_TransactionNo của giao dịch hoàn',
      (status) => {
        expect(
          interpret({ ...OK_RESPONSE, vnp_TransactionStatus: status }),
        ).toEqual({
          outcome: 'SUCCESS',
          gatewayRef: '14000099',
          failureReason: null,
        });
      },
    );

    it('thiếu vnp_TransactionNo thì dùng vnp_ResponseId; thiếu cả hai thì null', () => {
      expect(
        interpret({ ...OK_RESPONSE, vnp_TransactionNo: undefined }).gatewayRef,
      ).toBe('resp0001');
      expect(
        interpret({
          ...OK_RESPONSE,
          vnp_TransactionNo: undefined,
          vnp_ResponseId: undefined,
        }).gatewayRef,
      ).toBeNull();
    });

    it('vnp_TransactionStatus 09 (giao dịch hoàn bị từ chối) ⇒ FAILED', () => {
      const result = interpret({ ...OK_RESPONSE, vnp_TransactionStatus: '09' });

      expect(result.outcome).toBe('FAILED');
      expect(result.gatewayRef).toBeNull();
      expect(result.failureReason).toContain('rejected');
    });

    it.each(['01', '02', '04', '07', 'xx', undefined])(
      'vnp_TransactionStatus %p (không xác định) ⇒ PENDING',
      (status) => {
        expect(
          interpret({ ...OK_RESPONSE, vnp_TransactionStatus: status }),
        ).toEqual({
          outcome: 'PENDING',
          gatewayRef: null,
          failureReason: null,
        });
      },
    );

    it('KHÔNG BAO GIỜ SUCCESS khi phản hồi không có chữ ký ⇒ ném lỗi (để RefundService giữ PENDING)', () => {
      expect(() =>
        interpret({ ...OK_RESPONSE, vnp_SecureHash: undefined }, 'absent'),
      ).toThrow('not signed');
    });
  });

  it('chữ ký sai ⇒ ném lỗi với MỌI mã, kể cả mã từ chối (nội dung không đáng tin)', () => {
    for (const body of [OK_RESPONSE, TOO_MANY_RESPONSE, NOT_FOUND_RESPONSE]) {
      expect(() => interpret(body, 'invalid')).toThrow('invalid signature');
    }
  });

  describe('từ chối XÁC ĐỊNH ⇒ FAILED kèm mã và lời nhắn của cổng', () => {
    it.each(['02', '03', '91', '95', '97'])('mã %s', (code) => {
      const result = interpret(
        {
          vnp_ResponseCode: code,
          vnp_Message: 'Some message',
        },
        'absent',
      );

      expect(result).toEqual({
        outcome: 'FAILED',
        gatewayRef: null,
        failureReason: `VNPay rejected the refund (code ${code}): Some message`,
      });
    });

    it('không thấy giao dịch gốc (mẫu thật của sandbox, có chữ ký)', () => {
      const result = interpret(NOT_FOUND_RESPONSE);

      expect(result.outcome).toBe('FAILED');
      expect(result.failureReason).toBe(
        'VNPay rejected the refund (code 91): Transaction not found',
      );
    });

    it('lời nhắn của cổng được gọn khoảng trắng và cắt còn 200 ký tự', () => {
      const result = interpret(
        {
          vnp_ResponseCode: '95',
          vnp_Message: `  a\n\t b ${'x'.repeat(500)}`,
        },
        'absent',
      );

      expect(result.failureReason).toMatch(
        /^VNPay rejected the refund \(code 95\): a b x+$/,
      );
      expect(result.failureReason!.length).toBeLessThanOrEqual(
        'VNPay rejected the refund (code 95): '.length + 200,
      );
    });

    it('thiếu lời nhắn thì không có đuôi ": "', () => {
      expect(
        interpret({ vnp_ResponseCode: '97' }, 'absent').failureReason,
      ).toBe('VNPay rejected the refund (code 97)');
    });
  });

  describe('mã 94 có hai nghĩa trái ngược (đo trên sandbox thật)', () => {
    it('"Too many refund count (>0)": giao dịch gốc hết lượt hoàn ⇒ FAILED xác định, hướng dẫn hoàn thủ công', () => {
      const result = interpret(TOO_MANY_RESPONSE);

      expect(result.outcome).toBe('FAILED');
      expect(result.failureReason).toContain('Too many refund count');
      expect(result.failureReason).toContain(MANUAL_REFUND_HINT);
    });

    it('"Request is duplicated" (không chữ ký): VNPay đã thấy mã yêu cầu này ⇒ PENDING, KHÔNG BAO GIỜ FAILED', () => {
      expect(interpret(DUPLICATE_RESPONSE, 'absent')).toEqual({
        outcome: 'PENDING',
        gatewayRef: null,
        failureReason: null,
      });
    });

    it('lời nhắn lạ ở mã 94 ⇒ PENDING (không đoán)', () => {
      expect(
        interpret(
          { vnp_ResponseCode: '94', vnp_Message: 'Something else' },
          'absent',
        ).outcome,
      ).toBe('PENDING');
      expect(interpret({ vnp_ResponseCode: '94' }, 'absent').outcome).toBe(
        'PENDING',
      );
    });
  });

  it.each(['99', '93', '12', 'abc', ''])(
    'mã %p (lỗi khác/mã lạ) ⇒ PENDING — chưa biết cổng đã nhận hay chưa',
    (code) => {
      expect(
        interpret({ vnp_ResponseCode: code, vnp_Message: 'x' }, 'absent'),
      ).toEqual({ outcome: 'PENDING', gatewayRef: null, failureReason: null });
    },
  );

  it('kết quả không bao giờ chứa khoá hay chữ ký', () => {
    for (const body of [OK_RESPONSE, TOO_MANY_RESPONSE, NOT_FOUND_RESPONSE]) {
      const text = JSON.stringify(interpret(body));

      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(body.vnp_SecureHash);
    }
  });
});
