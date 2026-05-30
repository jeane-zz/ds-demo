import OpenAI from "openai";
import { getRequiredEnv, MissingEnvError } from "@/app/lib/env";

const SYSTEM_PROMPT =
  "你是一个会话标题生成助手。根据用户问题与助手回答，生成一个不超过 12 个字的中文标题，概括这次对话的主题。只输出标题本身，不要引号、不要标点结尾、不要解释。";

export async function POST(req: Request) {
  try {
    const apiKey = getRequiredEnv("DEEPSEEK_API_KEY");
    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com",
    });

    const { userMessage, assistantMessage } = await req.json();
    if (typeof userMessage !== "string" || !userMessage.trim()) {
      return Response.json({ error: "userMessage required" }, { status: 400 });
    }

    const completion = await client.chat.completions.create({
      model: "deepseek-chat",
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `用户提问：\n${userMessage}\n\n助手回答：\n${
            assistantMessage ?? ""
          }`,
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    const title = raw
      .replace(/[\n\r"'《》「」【】]/g, "")
      .replace(/^标题[:：]?\s*/, "")
      .trim()
      .slice(0, 20);

    return Response.json({ title });
  } catch (error) {
    if (error instanceof MissingEnvError) {
      console.error("Title API config error:", error.message);
      return Response.json(
        { error: `Service unavailable: ${error.key} is not configured` },
        { status: 503 }
      );
    }
    console.error("Title API error:", error);
    return Response.json({ error: "Failed to generate title" }, { status: 500 });
  }
}
