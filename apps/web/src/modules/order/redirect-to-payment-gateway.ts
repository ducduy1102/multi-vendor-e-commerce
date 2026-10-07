// Chuyển NGUYÊN TRANG sang cổng thanh toán (URL bên ngoài nên không dùng router nội bộ). Tách ra hàm
// riêng ở module scope vì gán `window.location` ngay trong component bị quy tắc
// react-hooks/immutability (React Compiler) chặn — hàm ngoài component thì không bị phân tích.
export function redirectToPaymentGateway(paymentUrl: string): void {
  window.location.href = paymentUrl;
}
