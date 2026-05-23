// CJK Unicode 范围
const CJK_REGEX = /[　-〿一-鿿＀-￯぀-ヿ]/g;

/**
 * 估算文本 token 数（启发式，零依赖）
 * - CJK 字符按 0.6 token / 字
 * - 其他字符按 0.3 token / 字
 * 与 BPE tokenizer（DeepSeek/GPT 系列）的实测偏差通常在 ±10% 内
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_REGEX) ?? []).length;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount * 0.6 + otherCount * 0.3);
}

/** 估算一组消息的 token 总数（含每条 ~4 tokens 的角色/分隔开销） */
export function estimateMessagesTokens(
  messages: { role: string; content: string }[]
): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(m.content) + 4,
    0
  );
}
