import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

export async function POST(req) {
    try {
        const {messages} = await req.json();
        const completion = await client.chat.completions.create({
            model: 'deepseek-chat',
            messages, 
            stream: true,
        });

        const encoder = new TextEncoder();

        const stream = new ReadableStream({
            async start(controller) {
                for await (const chunk of completion) {
                    const text = chunk.choices?.[0]?.delta?.content || '';
                    controller.enqueue(encoder.encode(text))
                }
                controller.close()
            }
        });
        return new Response(stream);
    } catch (error) {
        console.log(error)
        return Response.json({
            error: 'chat err'
        })
    }

}



// export async function GET() {
//   const completion = await client.chat.completions.create({
//     model: "deepseek-chat",
//     messages: [
//       {
//         role: "user",
//         content: "解释一下 React Fiber",
//       },
//     ],
//     stream: true, // 流式开关
//     // 不加 stream: true → 一次性返回完整结果
//     // 加了：→ 返回 AsyncIterator（异步迭代器）

//   });

//   const encoder = new TextEncoder();

//   const stream = new ReadableStream({
//     async start(controller) {
//     // 异步流读取
//       for await (const chunk of completion) {
//         // 取出这次新增的文本， 只取新增的文本。增量内容。
//         const text = chunk.choices?.[0]?.delta?.content || "";

//         controller.enqueue(encoder.encode(text));
//       }

//       controller.close();
//     },
//   });

//   return new Response(stream);
// }

