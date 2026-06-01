import { toLlmErrorResponse } from "@/app/lib/llm/errors";
import { createOpenAIClient, runWithLlmFallback } from "@/app/lib/llm/provider";

const SYSTEM_PROMPT =
  "你是一个会话标题生成助手。根据用户问题与助手回答，生成一个不超过 12 个字的中文标题，概括这次对话的主题。只输出标题本身，不要引号、不要标点结尾、不要解释。";

export async function POST(req: Request) {
  try {
    const { userMessage, assistantMessage } = await req.json();
    if (typeof userMessage !== "string" || !userMessage.trim()) {
      return Response.json({ error: "userMessage required" }, { status: 400 });
    }

    const completion = await runWithLlmFallback(
      (provider) =>
        createOpenAIClient(provider).chat.completions.create({
          model: provider.model,
          stream: false,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `用户提问：\n${userMessage}\n\n助手回答：\n${assistantMessage ?? ""}`,
            },
          ],
        }),
      { operationName: "title generation" }
    );

    const raw = completion.choices?.[0]?.message?.content ?? "";
    const title = raw
      .replace(/[\n\r"'《》「」【】]/g, "")
      .replace(/^标题[:：]?\s*/, "")
      .trim()
      .slice(0, 20);

    return Response.json({ title });
  } catch (error) {
    console.error("Title API error:", error);
    return toLlmErrorResponse(error);
  }
}
