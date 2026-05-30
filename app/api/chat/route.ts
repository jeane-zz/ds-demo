import OpenAI from "openai";
import { getRequiredEnv, MissingEnvError } from "@/app/lib/env";

export async function POST(req: Request) {
  try {
    const apiKey = getRequiredEnv("DEEPSEEK_API_KEY");
    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com",
    });

    const { messages } = await req.json();
    const completion = await client.chat.completions.create({
      model: "deepseek-chat",
      messages,
      stream: true,
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of completion) {
          const text = chunk.choices?.[0]?.delta?.content || "";
          controller.enqueue(encoder.encode(text));
        }
        controller.close();
      },
    });

    return new Response(stream);
  } catch (error) {
    if (error instanceof MissingEnvError) {
      console.error("Chat API config error:", error.message);
      return Response.json(
        { error: `Service unavailable: ${error.key} is not configured` },
        { status: 503 }
      );
    }
    console.error("Chat API error:", error);
    return Response.json({ error: "Failed to process chat request" }, { status: 500 });
  }
}

