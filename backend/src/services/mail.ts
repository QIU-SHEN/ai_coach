import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendPasswordResetEmail(to: string, resetLink: string) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'AI销售陪练系统 - 密码重置',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #2563eb;">密码重置</h2>
        <p>您申请了重置密码，请点击下方链接完成操作：</p>
        <p>
          <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">
            重置密码
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">如果按钮无法点击，请复制以下链接到浏览器地址栏打开：</p>
        <p style="background: #f3f4f6; padding: 10px; border-radius: 6px; font-size: 13px; word-break: break-all; color: #374151;">${resetLink}</p>
        <p style="color: #666; font-size: 14px;">链接有效期为 30 分钟。如非本人操作，请忽略此邮件。</p>
      </div>
    `.trim(),
  });
}
