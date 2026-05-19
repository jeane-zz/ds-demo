import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

export async function POST(req: Request) {
  try {
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
    console.error("Chat API error:", error);
    return Response.json({ error: "chat err" });
  }
}

