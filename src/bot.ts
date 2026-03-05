import { Client, GatewayIntentBits, Partials, AttachmentBuilder } from "discord.js";
import { MastraClient } from "@mastra/client-js";

import type { Message } from "discord.js";

const CHUNK_SIZE = 1200;

const MAX_DISCORD_FILES = 10;
const IMAGE_KEYWORDS = /차트|캔들|candle|chart|그래프|graph/i;

function extractBase64Images(obj: unknown): Buffer[] {
  const json = JSON.stringify(obj);
  const regex = /data:image\/[a-z]+;base64,([A-Za-z0-9+/=]{1000,})/g;
  const images: Buffer[] = [];
  const seen = new Set<string>();
  let match;
  while ((match = regex.exec(json)) !== null) {
    const key = match[1].slice(0, 64);
    if (seen.has(key)) continue;
    seen.add(key);
    images.push(Buffer.from(match[1], "base64"));
    if (images.length >= MAX_DISCORD_FILES) break;
  }
  return images;
}

function textMentionsNewImage(text: string): boolean {
  return IMAGE_KEYWORDS.test(text);
}

function cleanImagePlaceholders(text: string): string {
  return text
    .replace(/\[.*?(?:이미지|차트|image|chart).*?\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function sendLongMessage(
  message: Message,
  text: string,
  files: AttachmentBuilder[] = [],
): Promise<void> {
  if (text.length <= CHUNK_SIZE) {
    await message.reply({ content: text, files });
    return;
  }
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  await message.reply({ content: chunks[0], files });
  for (let i = 1; i < chunks.length; i++) {
    if ("send" in message.channel) {
      await message.channel.send(chunks[i]);
    }
  }
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

        let text = typeof response.text === "string" ? response.text.trim() : "";

        let files: AttachmentBuilder[] = [];
        if (textMentionsNewImage(text)) {
          const images = extractBase64Images(response);
          files = images.map(
            (buf, i) => new AttachmentBuilder(buf, { name: `chart_${i + 1}.jpg` }),
          );
          if (files.length > 0) {
            text = cleanImagePlaceholders(text);
          }
        }

        await sendLongMessage(message, text || "응답을 생성하지 못했습니다.", files);
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
