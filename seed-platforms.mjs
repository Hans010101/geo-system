import { createConnection } from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const connection = await createConnection(DATABASE_URL);

// Delete old platform configs
await connection.execute(`DELETE FROM platformConfigs`);
console.log("Cleared old platform configs");

const platforms = [
  { platform: "chatgpt", displayName: "ChatGPT", isEnabled: true, modelVersion: "gpt-4o", collectFrequency: "weekly" },
  { platform: "perplexity", displayName: "Perplexity", isEnabled: true, modelVersion: "sonar-pro", collectFrequency: "weekly" },
  { platform: "gemini", displayName: "Gemini", isEnabled: true, modelVersion: "gemini-2.0-flash", collectFrequency: "weekly" },
  { platform: "wenxin", displayName: "文心一言", isEnabled: true, modelVersion: "ernie-4.0-turbo", collectFrequency: "weekly" },
  { platform: "claude", displayName: "Claude", isEnabled: true, modelVersion: "claude-sonnet-4", collectFrequency: "weekly" },
  { platform: "copilot", displayName: "Copilot", isEnabled: true, modelVersion: "gpt-4o", collectFrequency: "weekly" },
  { platform: "doubao", displayName: "豆包", isEnabled: true, modelVersion: "doubao-1.5-pro-32k", collectFrequency: "weekly" },
  { platform: "kimi", displayName: "Kimi", isEnabled: true, modelVersion: "kimi-k2", collectFrequency: "weekly" },
  { platform: "deepseek", displayName: "DeepSeek", isEnabled: true, modelVersion: "deepseek-chat-v3", collectFrequency: "weekly" },
  { platform: "minimax", displayName: "MiniMax", isEnabled: true, modelVersion: "minimax-m1", collectFrequency: "weekly" },
  { platform: "tongyi", displayName: "通义千问", isEnabled: true, modelVersion: "qwen-plus", collectFrequency: "weekly" },
  { platform: "zhipu", displayName: "智谱清言", isEnabled: true, modelVersion: "glm-4-plus", collectFrequency: "weekly" },
  { platform: "grok", displayName: "Grok", isEnabled: true, modelVersion: "grok-3", collectFrequency: "weekly" },
  { platform: "llama", displayName: "Llama", isEnabled: false, modelVersion: "llama-4-maverick", collectFrequency: "weekly" },
  { platform: "hunyuan", displayName: "混元", isEnabled: false, modelVersion: "hunyuan-turbo", collectFrequency: "weekly" },
];

for (const p of platforms) {
  await connection.execute(
    `INSERT INTO platformConfigs (platform, displayName, isEnabled, modelVersion, collectFrequency) VALUES (?, ?, ?, ?, ?)`,
    [p.platform, p.displayName, p.isEnabled, p.modelVersion, p.collectFrequency]
  );
}
console.log(`Seeded ${platforms.length} platform configs`);

await connection.end();
console.log("Platform seed complete!");
