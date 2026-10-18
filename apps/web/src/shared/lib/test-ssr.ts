import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

// Render `ui` đúng như server làm (HTML thô trước khi có JS/hydration) rồi parse thành Document để truy vấn
// bằng DOM thường. Dùng cho test kiểu "form gửi được khi JS chưa chạy thì mật khẩu có lên URL không" — render
// phía client của RTL không thấy được trạng thái trước hydrate, nên không thay thế được.
export function renderServerHtml(ui: ReactElement): Document {
  return new DOMParser().parseFromString(renderToString(ui), 'text/html');
}
