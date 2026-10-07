import { escapeHtml, formatVnd } from './html';
import type { OrderEmailOrder } from './order-email.types';

// Khung + khối dùng chung của 4 email đơn hàng. CSS inline (email client không đọc <style>/Tailwind);
// màu theo thương hiệu (#0F766E) vì email nằm ngoài hệ token của web.
const BRAND = '#0F766E';
const MUTED = '#6B7280';

export function renderEmail(title: string, bodyHtml: string): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827;line-height:1.5">
      <h2 style="color:${BRAND};margin:0 0 16px">${escapeHtml(title)}</h2>
      ${bodyHtml}
      <p style="color:${MUTED};font-size:12px;margin-top:24px">
        Đây là email tự động, vui lòng không trả lời.
      </p>
    </div>
  `;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 12px">${escapeHtml(text)}</p>`;
}

export function button(url: string, label: string): string {
  return `<p style="margin:16px 0"><a href="${escapeHtml(url)}" style="background:${BRAND};color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(label)}</a></p>`;
}

// Hộp tóm tắt 1 đơn (1 shop): dòng hàng + phí ship + giảm giá + tổng.
export function renderOrderBlock(order: OrderEmailOrder): string {
  const rows = order.items
    .map((item) => {
      const name = item.variantLabel
        ? `${item.productName} (${item.variantLabel})`
        : item.productName;
      return `<tr>
        <td style="padding:4px 0">${escapeHtml(name)} × ${item.quantity}</td>
        <td style="padding:4px 0;text-align:right">${formatVnd(item.unitPrice * item.quantity)}</td>
      </tr>`;
    })
    .join('');
  const discount =
    order.discountAmount > 0
      ? `<tr><td style="padding:4px 0;color:${MUTED}">Giảm giá</td><td style="padding:4px 0;text-align:right">-${formatVnd(order.discountAmount)}</td></tr>`
      : '';

  return `
    <div style="border:1px solid #E5E7EB;border-radius:8px;padding:12px;margin:0 0 12px">
      <p style="margin:0 0 8px"><strong>${escapeHtml(order.shopName)}</strong> <span style="color:${MUTED}">· Mã đơn #${escapeHtml(order.orderCode)}</span></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${rows}
        <tr><td style="padding:4px 0;color:${MUTED}">Phí vận chuyển</td><td style="padding:4px 0;text-align:right">${formatVnd(order.shippingFee)}</td></tr>
        ${discount}
        <tr><td style="padding:8px 0 0;border-top:1px solid #E5E7EB"><strong>Tổng cộng</strong></td><td style="padding:8px 0 0;border-top:1px solid #E5E7EB;text-align:right"><strong>${formatVnd(order.totalAmount)}</strong></td></tr>
      </table>
    </div>
  `;
}
