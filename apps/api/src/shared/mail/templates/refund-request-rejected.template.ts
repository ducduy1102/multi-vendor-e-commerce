import type { MailLocale } from '../mail-locale';
import { escapeHtml } from './html';
import {
  button,
  paragraph,
  renderEmail,
  renderOrderBlock,
} from './order-email.layout';
import type {
  RefundRequestEmailKind,
  RefundRequestRejectedBy,
  RefundRequestRejectedEmailData,
} from './order-email.types';

interface Copy {
  kindLabels: Record<RefundRequestEmailKind, string>;
  subjects: Record<
    RefundRequestRejectedBy,
    (kindLabel: string, orderCode: string) => string
  >;
  title: string;
  greeting: (name: string) => string;
  leads: Record<
    RefundRequestRejectedBy,
    (shopName: string, orderCode: string, kindLabel: string) => string
  >;
  reasonLabel: string;
  escalate: (days: number) => string;
  final: string;
  viewOrder: string;
}

const daysEn = (n: number) => (n === 1 ? '1 day' : `${n} days`);

const COPY: Record<MailLocale, Copy> = {
  vi: {
    kindLabels: { CANCEL: 'hủy đơn', RETURN: 'trả hàng/hoàn tiền' },
    subjects: {
      SELLER: (kind, code) =>
        `Shop đã từ chối yêu cầu ${kind} cho đơn #${code}`,
      ADMIN: (kind, code) => `Yêu cầu ${kind} cho đơn #${code} đã bị từ chối`,
    },
    title: 'Yêu cầu của bạn đã bị từ chối',
    greeting: (name) => `Chào ${name},`,
    leads: {
      SELLER: (shop, code, kind) =>
        `Shop ${shop} đã từ chối yêu cầu ${kind} của bạn cho đơn hàng #${code}.`,
      ADMIN: (_shop, code, kind) =>
        `Sau khi xem xét, sàn đã từ chối yêu cầu ${kind} của bạn cho đơn hàng #${code}.`,
    },
    reasonLabel: 'Lý do',
    escalate: (days) =>
      `Nếu không đồng ý, bạn có thể khiếu nại lên sàn từ trang đơn hàng trong ${days} ngày kể từ hôm nay.`,
    final: 'Đây là quyết định cuối cùng của sàn đối với yêu cầu này.',
    viewOrder: 'Xem đơn hàng',
  },
  en: {
    kindLabels: { CANCEL: 'cancellation', RETURN: 'return/refund' },
    subjects: {
      SELLER: (kind, code) =>
        `The shop declined your ${kind} request for order #${code}`,
      ADMIN: (kind, code) =>
        `Your ${kind} request for order #${code} was declined`,
    },
    title: 'Your request was declined',
    greeting: (name) => `Hi ${name},`,
    leads: {
      SELLER: (shop, code, kind) =>
        `${shop} declined your ${kind} request for order #${code}.`,
      ADMIN: (_shop, code, kind) =>
        `After reviewing it, we declined your ${kind} request for order #${code}.`,
    },
    reasonLabel: 'Reason',
    escalate: (days) =>
      `If you disagree, you can escalate to us from the order page within ${daysEn(days)} from today.`,
    final: 'This is our final decision on this request.',
    viewOrder: 'View order',
  },
};

// Yêu cầu hủy / trả hàng bị từ chối — bởi shop (người mua còn đường khiếu nại lên sàn trong `escalateDays` ngày) hoặc
// bởi Admin (quyết định cuối cùng). LÝ DO do shop/Admin tự nhập nên luôn qua escapeHtml (xem html.ts).
export function refundRequestRejectedTemplate(
  data: RefundRequestRejectedEmailData,
): { subject: string; html: string } {
  const copy = COPY[data.locale];
  const kindLabel = copy.kindLabels[data.kind];
  const subject = copy.subjects[data.rejectedBy](
    kindLabel,
    data.order.orderCode,
  );
  const reason = data.reason
    ? `<p style="margin:0 0 12px"><strong>${escapeHtml(copy.reasonLabel)}:</strong> ${escapeHtml(data.reason)}</p>`
    : '';
  const next =
    data.rejectedBy === 'SELLER' && data.escalateDays !== null
      ? paragraph(copy.escalate(data.escalateDays))
      : data.rejectedBy === 'ADMIN'
        ? paragraph(copy.final)
        : '';
  const html = renderEmail(
    copy.title,
    `
      ${paragraph(copy.greeting(data.buyerName))}
      ${paragraph(copy.leads[data.rejectedBy](data.order.shopName, data.order.orderCode, kindLabel))}
      ${reason}
      ${renderOrderBlock(data.order, data.locale)}
      ${next}
      ${button(data.ordersUrl, copy.viewOrder)}
    `,
    data.locale,
  );
  return { subject, html };
}
