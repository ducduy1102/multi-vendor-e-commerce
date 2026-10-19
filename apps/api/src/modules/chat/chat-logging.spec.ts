import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Kiểm kê MỌI chỗ module chat ghi log (Week10.md 4.8, checklist bảo mật: "không có nội dung tin hay token trong
// bất kỳ lời gọi logger nào"). Test hành vi (chat.controller.int-spec.ts quét log thật) chỉ thấy những đường đã
// được thử; test này là lớp thứ hai, tĩnh: nó đọc mã nguồn, liệt kê từng lời gọi logger và chỉ chấp nhận đúng
// những biểu thức nội suy đã duyệt (id tin, id hội thoại, thông điệp lỗi). Thêm một lời gọi log mới, hoặc nội suy
// một giá trị mới vào log, sẽ làm test này đỏ để người viết phải dừng lại xét: giá trị đó có phải dữ liệu riêng tư
// không? Cố ý chặt — đó là mục đích.
const DIR = __dirname;
const sources = readdirSync(DIR)
  .filter(
    (name) => name.endsWith('.ts') && !/\.(spec|int-spec)\.ts$/.test(name),
  )
  .map((name) => ({ name, text: readFileSync(join(DIR, name), 'utf8') }));

interface LogCall {
  file: string;
  level: string;
  text: string;
  interpolations: string[];
}

// Lấy toàn bộ lời gọi `this.logger.<level>(...)` bằng cách đếm ngoặc cân bằng từ dấu mở.
function logCallsOf(file: string, text: string): LogCall[] {
  const calls: LogCall[] = [];
  const start = /this\.logger\.(\w+)\(/g;
  for (let match = start.exec(text); match; match = start.exec(text)) {
    let depth = 1;
    let end = start.lastIndex;
    while (depth > 0 && end < text.length) {
      const ch = text[end++];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    const body = text.slice(start.lastIndex, end - 1);
    calls.push({
      file,
      level: match[1],
      text: body,
      interpolations: [...body.matchAll(/\$\{([^}]*)\}/g)].map((m) =>
        m[1].replace(/\s+/g, ' ').trim(),
      ),
    });
  }
  return calls;
}

const allCalls = sources.flatMap(({ name, text }) => logCallsOf(name, text));

// Các biểu thức được phép nội suy vào log: id (không phải dữ liệu riêng tư) và thông điệp lỗi.
const ALLOWED_INTERPOLATIONS = [
  'message.id', // id của tin (UUID), không phải nội dung
  'payload.conversationId', // id hội thoại (UUID)
  'error instanceof Error ? error.message : String(error)', // thông điệp lỗi, không phải dữ liệu đầu vào
];

describe('kiểm kê log của module chat', () => {
  it('chỉ có đúng 3 lời gọi logger, đều ở mức error, ở các chỗ đã duyệt', () => {
    expect(
      allCalls.map(({ file, level }) => `${file}:${level}`).sort(),
    ).toEqual([
      'chat.gateway.ts:error',
      'chat.service.ts:error',
      'chat.service.ts:error',
    ]);
  });

  it.each(
    allCalls.map(
      (call) =>
        [
          `${call.file}: ${call.text.replace(/\s+/g, ' ').slice(0, 60)}`,
          call,
        ] as const,
    ),
  )('lời gọi log %s chỉ nội suy biểu thức đã duyệt', (_name, call) => {
    for (const expression of call.interpolations) {
      expect(ALLOWED_INTERPOLATIONS).toContain(expression);
    }
  });

  it('mọi lời gọi log đều có chuỗi mô tả cố định (không truyền nguyên đối tượng/payload/lỗi vào log)', () => {
    for (const call of allCalls) {
      // Đối số đầu phải là template literal / chuỗi, không phải biến trần như `error` hay `payload`.
      expect(call.text.trim()).toMatch(/^[`'"]/);
      // và không có đối số thứ hai (vd `logger.error(msg, error.stack)` hay `logger.error(msg, payload)`).
      expect(call.text.replace(/\$\{[^}]*\}/g, '')).not.toMatch(
        /[`'"]\s*,\s*\S/,
      );
    }
  });

  it('module chat không dùng console.* hay Logger tĩnh (đi vòng khỏi kiểm kê này)', () => {
    for (const { name, text } of sources) {
      expect({ name, hit: /\bconsole\.\w+\(/.test(text) }).toEqual({
        name,
        hit: false,
      });
      expect({
        name,
        hit: /\bLogger\.(log|error|warn|debug|verbose|fatal)\(/.test(text),
      }).toEqual({ name, hit: false });
    }
  });

  it('bộ kiểm kê này thật sự bắt được lời gọi nguy hiểm (kiểm chứng chính nó)', () => {
    const risky = logCallsOf(
      'giả.ts',
      'this.logger.error(`failed for ${conversation.content}`);',
    );

    expect(risky).toHaveLength(1);
    expect(
      risky[0].interpolations.every((e) => ALLOWED_INTERPOLATIONS.includes(e)),
    ).toBe(false);
  });
});
