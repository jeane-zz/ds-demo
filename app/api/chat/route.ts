import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat";
import { toLlmErrorResponse } from "@/app/lib/llm/errors";
import { createOpenAIClient, runWithLlmFallback } from "@/app/lib/llm/provider";
import {
  executeToolCall,
  toolDefinitions,
  toolUseInstruction,
} from "@/app/lib/tools/registry";

const MAX_TOOL_ROUNDS = 2;

interface IncomingMessage {
  role: string;
  content: string;
}

function toChatMessages(messages: IncomingMessage[]): ChatCompletionMessageParam[] {
  return messages
    .filter(
      (message) =>
        (message.role === "system" ||
          message.role === "user" ||
          message.role === "assistant") &&
        typeof message.content === "string"
    )
    .map((message) => ({
      role: message.role as "system" | "user" | "assistant",
      content: message.content,
    }));
}

async function createTextStream(
  messages: ChatCompletionMessageParam[]
): Promise<ReadableStream<Uint8Array>> {
  const completion = await runWithLlmFallback(
    (provider) =>
      createOpenAIClient(provider).chat.completions.create({
        model: provider.model,
        messages,
        stream: true,
      }),
    { operationName: "chat stream" }
  );

  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      for await (const chunk of completion) {
        const text = chunk.choices?.[0]?.delta?.content || "";
        controller.enqueue(encoder.encode(text));
      }
      controller.close();
    },
  });
}

export async function POST(req: Request) {
  try {
    const { messages, sessionId } = (await req.json()) as {
      messages?: IncomingMessage[];
      sessionId?: string;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: "messages required" }, { status: 400 });
    }

    const conversation = toChatMessages(messages);
    if (conversation.length === 0) {
      return Response.json({ error: "valid messages required" }, { status: 400 });
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const decisionMessages: ChatCompletionMessageParam[] = [
        ...conversation,
        { role: "system", content: toolUseInstruction },
      ];

      const decision = await runWithLlmFallback(
        (provider) =>
          createOpenAIClient(provider).chat.completions.create({
            model: provider.model,
            messages: decisionMessages,
            stream: false,
            tools: toolDefinitions,
            tool_choice: "auto",
          }),
        { operationName: "chat tool decision" }
      );

      const assistantMessage = decision.choices?.[0]?.message;
      const toolCalls = assistantMessage?.tool_calls ?? [];

      if (toolCalls.length === 0) {
        const stream = await createTextStream(conversation);
        return new Response(stream);
      }

      conversation.push({
        role: "assistant",
        content: assistantMessage.content ?? null,
        tool_calls: toolCalls,
      } satisfies ChatCompletionAssistantMessageParam);

      for (const toolCall of toolCalls) {
        const result = await executeToolCall(toolCall, { sessionId });
        console.info("Local tool call:", toolCall.type, result);
        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }

    conversation.push({
      role: "system",
      content:
        "本地工具调用已达到最大轮次。请基于已有工具结果回答；如果信息不足，请明确说明。",
    });

    const stream = await createTextStream(conversation);

    return new Response(stream);
  } catch (error) {
    console.error("Chat API error:", error);
    return toLlmErrorResponse(error);
  }
}
