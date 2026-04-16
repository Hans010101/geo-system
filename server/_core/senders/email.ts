import type { SendResult } from "./feishu";

export async function sendEmail(config: {
  smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; from: string; to: string[];
}, payload: { title: string; content: string }): Promise<SendResult> {
  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: { user: config.smtpUser, pass: config.smtpPass },
    });
    const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#EF0027;color:white;padding:16px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:16px">TRON GEO 系统 - 预警通知</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
        <h3 style="margin:0 0 12px">${payload.title}</h3>
        <p style="color:#4b5563;line-height:1.6;white-space:pre-wrap">${payload.content}</p>
      </div>
    </div>`;
    await transport.sendMail({ from: config.from, to: config.to.join(","), subject: payload.title, html });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
