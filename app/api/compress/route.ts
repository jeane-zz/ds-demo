import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

const SYSTEM_PROMPT =
  "你是一个对话摘要助手。请将下面的对话历史压缩成结构化摘要，要求：\n" +
  "1. 保留所有关键技术点、用户偏好、已确认的结论、代码片段中的关键 API；\n" +
  "2. 用「要点列表」形式输出，不要寒暄，不要复述完整对话；\n" +
  "3. 如果已经存在『先前摘要』，请将其与新对话合并去重，不要丢失之前的信息；\n" +
  "4. 输出控制在 400 字以内，使用中文。";

interface CompressMessage {
  role: string;
  content: string;
}

export async function POST(req: Request) {
  try {
    const { messages, previousSummary } = (await req.json()) as {
      messages: CompressMessage[];
      previousSummary?: string;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: "messages required" }, { status: 400 });
    }

    // 把对话历史拼成一段纯文本，避免占用过多 role 槽
    const transcript = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `【${m.role === "user" ? "用户" : "助手"}】${m.content}`)
      .join("\n\n");

    const userContent =
      (previousSummary
        ? `先前摘要：\n${previousSummary}\n\n新增对话：\n`
        : `对话历史：\n`) + transcript;

    const completion = await client.chat.completions.create({
      model: "deepseek-chat",
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const summary = (completion.choices?.[0]?.message?.content ?? "").trim();
    if (!summary) {
      return Response.json({ error: "empty summary" }, { status: 500 });
    }

    return Response.json({ summary });
  } catch (error) {
    console.error("Compress API error:", error);
    return Response.json({ error: "compress err" }, { status: 500 });
  }
}
