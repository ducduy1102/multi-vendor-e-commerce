import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { getFrontendUrl } from '../../shared/utils/frontend-url';
import {
  isMockPaymentEnabled,
  MockPaymentProvider,
} from '../../shared/payment/mock-payment.provider';
import { VnpayProvider } from '../../shared/payment/vnpay.provider';
import { PaymentService } from './payment.service';
import {
  mapOutcomeToVnpayIpnResponse,
  VNPAY_UNEXPECTED_ERROR_RESPONSE,
} from './vnpay-ipn-response';

// Endpoint gọi bởi CỔNG THANH TOÁN (Week7.md 1.10, 2.9) — KHÔNG JWT, xác thực bằng chữ ký. Mọi
// handler ở đây tự gửi response bằng @Res() KHÔNG passthrough (bỏ qua TransformResponseInterceptor/
// AllExceptionsFilter toàn cục) và tự try/catch — VNPay cần thấy đúng {RspCode, Message} ở mức gốc,
// không phải {success, data: {RspCode}}.
@ApiTags('payments')
@Controller('payments')
export class OrderController {
  private readonly logger = new Logger(OrderController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly vnpayProvider: VnpayProvider,
    private readonly mockPaymentProvider: MockPaymentProvider,
  ) {}

  @Get('vnpay/ipn')
  @ApiOperation({
    summary:
      'IPN của VNPay (server-to-server) — CHỈ VNPay gọi, xác thực bằng vnp_SecureHash, không JWT',
  })
  @ApiResponse({
    status: 200,
    description: 'Luôn 200; kết quả thật nằm trong RspCode',
    schema: { example: { RspCode: '00', Message: 'Confirm Success' } },
  })
  async vnpayIpn(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const verified = this.vnpayProvider.verifyCallback(req.query);
      const result = await this.paymentService.confirmPayment(verified, 'IPN');
      res.status(200).json(mapOutcomeToVnpayIpnResponse(result.outcome));
    } catch (error) {
      this.logger.error('Unexpected error handling VNPay IPN', error);
      // 99 để VNPay tự thử lại — KHÔNG trả 00 khi chưa chắc đã ghi nhận được (1.9).
      res.status(200).json(VNPAY_UNEXPECTED_ERROR_RESPONSE);
    }
  }

  @Get('vnpay/return')
  @ApiOperation({
    summary:
      'Trình duyệt quay về sau khi thanh toán VNPay — kiểm chữ ký rồi 302 tới trang kết quả FE',
  })
  @ApiResponse({ status: 302, description: 'Redirect về /checkout/result' })
  async vnpayReturn(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const verified = this.vnpayProvider.verifyCallback(req.query);
      if (!verified.isSignatureValid) {
        return this.redirectToResultError(res);
      }
      let checkoutGroupId: string | null = null;
      try {
        const result = await this.paymentService.confirmPayment(
          verified,
          'RETURN',
        );
        checkoutGroupId = result.checkoutGroupId;
      } catch (error) {
        this.logger.error('confirmPayment failed on VNPay return', error);
      }
      if (!checkoutGroupId) {
        return this.redirectToResultError(res);
      }
      return this.redirectToResultSuccess(res, checkoutGroupId);
    } catch (error) {
      this.logger.error('Unexpected error handling VNPay return', error);
      return this.redirectToResultError(res);
    }
  }

  // Chỉ dev/test — vô hiệu hoá cứng ở production (3 lớp: đây + MockPaymentProvider.isConfigured() +
  // createPayment(), Week7.md 1.9). Trang cho chọn thành công/thất bại/bỏ qua, đi ĐÚNG đường xác
  // nhận thật (confirmPayment) như cổng thật — dùng cho Playwright/demo sau này.
  @Get('mock/pay')
  @ApiExcludeEndpoint()
  mockPay(@Req() req: Request, @Res() res: Response): void {
    if (!isMockPaymentEnabled()) throw new NotFoundException();
    const { txnRef, amount, sig } = this.readMockQuery(req);
    if (!this.mockPaymentProvider.verifyPayLink(txnRef, amount, sig)) {
      throw new NotFoundException();
    }
    const link = (outcome: string) =>
      `/api/v1/payments/mock/confirm?txnRef=${encodeURIComponent(txnRef)}&amount=${encodeURIComponent(amount)}&sig=${encodeURIComponent(sig)}&outcome=${outcome}`;
    res
      .status(200)
      .type('html')
      .send(
        `<!doctype html><html><body style="font-family:sans-serif">
          <h1>Mock payment</h1>
          <p>txnRef: ${escapeHtml(txnRef)} — amount: ${escapeHtml(amount)}</p>
          <p><a href="${link('SUCCESS')}">Thành công</a></p>
          <p><a href="${link('FAILED')}">Thất bại</a></p>
          <p><a href="${link('PENDING')}">Bỏ qua (không xác định)</a></p>
        </body></html>`,
      );
  }

  @Get('mock/confirm')
  @ApiExcludeEndpoint()
  async mockConfirm(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!isMockPaymentEnabled()) throw new NotFoundException();
    const { txnRef, amount, sig } = this.readMockQuery(req);
    const outcome =
      typeof req.query.outcome === 'string' ? req.query.outcome : '';
    if (
      !this.mockPaymentProvider.verifyPayLink(txnRef, amount, sig) ||
      !['SUCCESS', 'FAILED', 'PENDING'].includes(outcome)
    ) {
      throw new NotFoundException();
    }
    const rawCallback = this.mockPaymentProvider.buildCallback(
      txnRef,
      Number(amount),
      outcome as 'SUCCESS' | 'FAILED' | 'PENDING',
    );
    const verified = this.mockPaymentProvider.verifyCallback(rawCallback);
    let checkoutGroupId: string | null = null;
    try {
      const result = await this.paymentService.confirmPayment(
        verified,
        'RETURN',
      );
      checkoutGroupId = result.checkoutGroupId;
    } catch (error) {
      this.logger.error('confirmPayment failed on mock confirm', error);
    }
    if (!checkoutGroupId) return this.redirectToResultError(res);
    return this.redirectToResultSuccess(res, checkoutGroupId);
  }

  private readMockQuery(req: Request): {
    txnRef: string;
    amount: string;
    sig: string;
  } {
    const { txnRef, amount, sig } = req.query;
    if (
      typeof txnRef !== 'string' ||
      typeof amount !== 'string' ||
      typeof sig !== 'string'
    ) {
      throw new NotFoundException();
    }
    return { txnRef, amount, sig };
  }

  // Không chuyển tiếp/phản chiếu bất kỳ tham số nào của cổng (chống XSS phản chiếu + rò rỉ mã giao
  // dịch, 1.10) — groupId lấy từ DB theo txnRef, không từ query của trình duyệt.
  private redirectToResultSuccess(
    res: Response,
    checkoutGroupId: string,
  ): void {
    res.redirect(
      `${getFrontendUrl()}/checkout/result?groupId=${encodeURIComponent(checkoutGroupId)}`,
    );
  }

  private redirectToResultError(res: Response): void {
    res.redirect(`${getFrontendUrl()}/checkout/result?error=invalid`);
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}
