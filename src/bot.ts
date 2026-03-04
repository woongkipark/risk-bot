import { Client, GatewayIntentBits, Partials } from "discord.js";
import { MastraClient } from "@mastra/client-js";

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 20)}\n... (truncated)`;
}

export function startBot(): void {
  const token = process.env.DISCORD_BOT_TOKEN;
  const targetChannelId = process.env.DISCORD_DAILY_CHANNEL_ID;
  const mastraUrl = process.env.MASTRA_API_URL;
  const mastraToken = process.env.MASTRA_ACCESS_TOKEN;

  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is required");
  }
  if (!mastraUrl) {
    throw new Error("MASTRA_API_URL is required");
  }

  const mastraClient = new MastraClient({
    baseUrl: mastraUrl,
    retries: 2,
    ...(mastraToken ? { headers: { Authorization: `Bearer ${mastraToken}` } } : {}),
  });

  const agent = mastraClient.getAgent("signal-risk-agent");

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel],
  });

  client.once("ready", () => {
    console.log(`discord bot ready: ${client.user?.tag}`);
    console.log(`mastra cloud: ${mastraUrl}`);
  });

  client.on("messageCreate", async (message) => {
    try {
      const query = message.content.trim();
      const isAutoTrigger = query.startsWith("#AUTO_");

      // 일반 메시지: 봇 발신 무시. 트리거 메시지: 봇/webhook 허용
      if (message.author.bot && !isAutoTrigger) return;
      if (targetChannelId && message.channelId !== targetChannelId) return;
      if (!query) return;

      await message.channel.sendTyping();
      const typingInterval = setInterval(() => {
        message.channel.sendTyping().catch(() => {});
      }, 8000);

      try {
        const response = await agent.generate(query, {
          memory: {
            thread: message.channelId,
            resource: "signal-risk-bot",
          },
        });

        const text = typeof response.text === "string" ? response.text.trim() : "";
        const out = truncate(text || "응답을 생성하지 못했습니다.", 1800);
        await message.reply(out);
      } finally {
        clearInterval(typingInterval);
      }
    } catch (error) {
      await message.reply("처리 중 오류가 발생했습니다. 잠시 후 다시 시도해줘.");
      console.error(error);
    }
  });

  client.login(token);
}
