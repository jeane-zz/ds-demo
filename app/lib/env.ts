/**
 * 环境变量验证工具
 *
 * 启动时检查关键环境变量并打印警告，
 * 提供运行时获取必填变量的工具，缺失时抛出明确错误。
 */

export class MissingEnvError extends Error {
  constructor(public readonly key: string) {
    super(`Missing required environment variable: ${key}`);
    this.name = 'MissingEnvError';
  }
}

/**
 * 必填的环境变量列表
 */
const REQUIRED_ENVS = ['DEEPSEEK_API_KEY'] as const;

/**
 * 获取必填环境变量，缺失时抛出 MissingEnvError
 */
export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new MissingEnvError(key);
  }
  return value;
}

/**
 * 检查必填环境变量并打印警告（用于启动时）
 */
function checkEnvsOnStartup(): void {
  const missing = REQUIRED_ENVS.filter(
    (k) => !process.env[k] || !process.env[k]?.trim()
  );

  if (missing.length > 0) {
    console.warn(
      `[env] Missing required environment variables: ${missing.join(', ')}\n` +
      `      API routes that depend on these will return 503.`
    );
  }
}

// 模块加载时触发一次检查
checkEnvsOnStartup();
