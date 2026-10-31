import { isUuid } from './is-uuid';

// `isUuid` chặn mọi id sai dạng TRƯỚC khi chạm DB (id có ký tự NUL làm Postgres ném lỗi ⇒ 500). Phải KHỚP TOÀN CHUỖI: một regex thiếu neo cho
// qua `xxx<uuid>` hay `<uuid>\n` và đưa chuỗi lạ xuống truy vấn.
const VALID = '3f2b8c1e-9d4a-4e6b-8a1c-0123456789ab';
const NUL = String.fromCharCode(0);

describe('isUuid', () => {
  it.each([
    ['chữ thường', VALID],
    ['chữ hoa', VALID.toUpperCase()],
    ['nil UUID', '00000000-0000-0000-0000-000000000000'],
  ])('nhận UUID hợp lệ (%s)', (_name, value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    ['rỗng', ''],
    ['chữ thường', 'not-a-uuid'],
    ['thiếu một ký tự', VALID.slice(0, -1)],
    ['thừa một ký tự', `${VALID}0`],
    ['có tiền tố', `x${VALID}`],
    ['có hậu tố', `${VALID}x`],
    ['có khoảng trắng đầu', ` ${VALID}`],
    ['có khoảng trắng cuối', `${VALID} `],
    ['có xuống dòng cuối', `${VALID}\n`],
    ['có NUL cuối', `${VALID}${NUL}`],
    ['có NUL giữa', `${VALID.slice(0, 8)}${NUL}${VALID.slice(8)}`],
    ['sai bộ ký tự (g)', VALID.replace('3f2b', 'gggg')],
    ['thiếu dấu gạch', VALID.split('-').join('')],
    ['hai UUID liền nhau', `${VALID}${VALID}`],
  ])('từ chối id sai dạng (%s)', (_name, value) => {
    expect(isUuid(value)).toBe(false);
  });
});
