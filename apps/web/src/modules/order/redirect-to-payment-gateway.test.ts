import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { redirectToPaymentGateway } from './redirect-to-payment-gateway';

describe('redirectToPaymentGateway', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'http://localhost:3000/orders' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('điều hướng trình duyệt tới đúng URL cổng thanh toán', () => {
    redirectToPaymentGateway('https://sandbox.vnpayment.vn/pay?x=1');

    expect(window.location.href).toBe('https://sandbox.vnpayment.vn/pay?x=1');
  });
});
