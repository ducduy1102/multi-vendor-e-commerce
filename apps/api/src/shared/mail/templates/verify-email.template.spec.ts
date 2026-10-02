import { verifyEmailTemplate } from './verify-email.template';

describe('verifyEmailTemplate', () => {
  const URL = 'http://localhost:3000/verify-email?token=abc123';

  it('giữ nguyên nội dung bình thường: tên có dấu và link xác thực', () => {
    const { subject, html } = verifyEmailTemplate('Nguyễn Văn A', URL);

    expect(subject).toBe('Xác thực email của bạn');
    expect(html).toContain('Chào Nguyễn Văn A,');
    expect(html).toContain(`<a href="${URL}">${URL}</a>`);
  });

  it('tên chứa HTML (kẻ tấn công đăng ký bằng email của nạn nhân) — được escape, không chèn được thẻ/link', () => {
    const { html } = verifyEmailTemplate(
      '<a href="https://evil.example">Bấm để giữ tài khoản</a><script>x()</script>',
      URL,
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="https://evil.example"');
    expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;');
    // Link xác thực thật vẫn nguyên vẹn và là link `<a>` duy nhất.
    expect(html).toContain(`<a href="${URL}">`);
    expect((html.match(/<a /g) ?? []).length).toBe(1);
  });

  it('URL có ký tự đặc biệt được escape đúng chỗ (href không bị thoát ra khỏi thuộc tính)', () => {
    const { html } = verifyEmailTemplate(
      'An',
      'http://localhost:3000/verify-email?token=a&next="><script>x()</script>',
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain(
      'href="http://localhost:3000/verify-email?token=a&amp;next=&quot;&gt;&lt;script&gt;x()&lt;/script&gt;"',
    );
  });
});
