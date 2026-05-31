<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 编码规范
- 函数组件 + Hooks，禁止类组件
- TS 严格模式，禁用 any
- 优先使用 TailwindCSS 写样式
- 组件小驼峰，文件小驼峰
- 状态提升合理，避免过度嵌套
- 代码简洁，注释必要即可
- 代码按最小功能点进行拆分
- 所有相关功能**必须使用minor-change实现**

## AI 要求
- 只生成符合规范的代码
- 不随意修改项目结构
- 优先简洁实现
- 不确定先问