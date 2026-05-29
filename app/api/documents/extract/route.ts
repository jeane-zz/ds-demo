import { NextRequest, NextResponse } from 'next/server';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const deepseek = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Invalid messages format' },
        { status: 400 }
      );
    }

    const conversationText = messages
      .map((m: { role: string; content: string }) => {
        const label = m.role === 'user' ? '问题' : '回答';
        return `${label}: ${m.content}`;
      })
      .join('\n\n');

    const prompt = `分析以下开发问题对话，提取结构化文档。

对话内容：
${conversationText}

要求：
1. title: 用一句话概括问题（15字以内）
2. category: 技术分类（从以下选择：React / Next.js / TypeScript / JavaScript / CSS / 性能优化 / Bug修复 / 工具配置 / 其他）
3. tags: 3-5个关键词标签（数组格式）
4. problem: 问题的详细描述（保留关键信息）
5. solution: 解决方案的详细步骤（保留代码和关键操作）
6. code: 提取所有代码块，用 \`\`\` 包裹（如果有多个代码块，用换行分隔）

输出严格的 JSON 格式，不要有任何其他文字：
{
  "title": "...",
  "category": "...",
  "tags": ["...", "..."],
  "problem": "...",
  "solution": "...",
  "code": "..."
}`;

    const { text } = await generateText({
      model: deepseek.chat('deepseek-chat'),
      prompt,
      temperature: 0.3,
    });

    let extracted;
    try {
      extracted = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse AI response');
      }
    }

    return NextResponse.json(extracted);
  } catch (error) {
    console.error('Extract document error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to extract document' },
      { status: 500 }
    );
  }
}
