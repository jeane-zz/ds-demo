// react-syntax-highlighter 包没有自带类型声明,
// 用最小化的 ambient declarations 抑制 TS7016,运行时类型由组件 prop 强制。
declare module "react-syntax-highlighter" {
  import type { ComponentType, CSSProperties, ReactNode } from "react";
  interface PrismProps {
    language?: string;
    style?: Record<string, CSSProperties>;
    PreTag?: keyof JSX.IntrinsicElements | ComponentType<unknown>;
    customStyle?: CSSProperties;
    children?: ReactNode;
  }
  export const Prism: ComponentType<PrismProps>;
  const SyntaxHighlighter: ComponentType<PrismProps>;
  export default SyntaxHighlighter;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  import type { CSSProperties } from "react";
  export const oneDark: Record<string, CSSProperties>;
}
