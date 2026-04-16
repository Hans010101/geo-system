export type SendResult = { success: boolean; error?: string };

export async function sendFeishu(webhookUrl: string, payload: { title: string; content: string; severity?: string }): Promise<SendResult> {
  try {
    const color = payload.severity === "critical" ? "red" : payload.severity === "high" ? "orange" : "blue";
    const body = {
      msg_type: "interactive",
      card: {
        header: { title: { tag: "plain_text", content: payload.title }, template: color },
        elements: [{ tag: "markdown", content: payload.content }],
      },
    };
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data.code !== 0 && data.StatusCode !== 0) return { success: false, error: data.msg || JSON.stringify(data) };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
