export function verifyEmailTemplate(
  name: string,
  verifyUrl: string,
): { subject: string; html: string } {
  return {
    subject: 'Xác thực email của bạn',
    html: `
      <p>Chào ${name},</p>
      <p>Vui lòng bấm vào link bên dưới để xác thực email (link hết hạn sau 24 giờ):</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>Nếu bạn không tạo tài khoản này, hãy bỏ qua email.</p>
    `,
  };
}
