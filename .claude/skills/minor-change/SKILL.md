---
name: minor-change
description: 在当前 ai-code-explainer 项目里实现一个小范围、单模块的需求。强约束最小代码改动，改完自动跑 `npm run lint` + `npm run build` 当作"测试"，通过后用 conventional commits 风格自动提交。当用户描述一个看起来局限于单文件/单组件/单 hook 的小需求、小改动、小调整、bug fix、文案修改、样式微调、加一个小功能、改一个 prop、调一个参数等时使用本 skill；用户不需要明确说"用 minor-change skill"。明显的大改造、跨多个模块的重构、新建多个文件的大功能不属于本 skill 适用范围。
---

# minor-change

帮用户在 `ai-code-explainer`（Next.js 16 + React 19 + AI SDK）项目里完成一个小需求，并把"做最小改动 → 验证 → 提交"这条链路一次跑完。

## 适用范围与边界

适用：单个文件 / 单个 hook / 单个组件 / 单个 API route 内的局部改动；bug fix；文案、样式、参数微调；加一个小 prop 或一个内部 helper。

不适用：跨多模块重构、引入新依赖、改动构建/配置/CI、生成大量新文件。如果初步分析后发现需求会触发跨模块大改，**先停下来告诉用户范围超了**，让用户决定是缩小需求还是放弃用本 skill。

## 工作流程

### 1. 理解需求并定位最小改动点

阅读用户描述，先想清楚：要改的最终行为是什么？最少改哪几行能达到这个行为？  
用 `Read` / `Grep` 定位相关文件。**不要**借机顺手"清理"或"重构"周边代码——本 skill 的全部价值就是克制。

如果用户当前 IDE 打开的文件（系统消息会告知）和需求相关，优先把它当作主要改动目标。

### 2. 实施最小改动

只动达成需求所必需的代码。具体地：

- 不新增文件，除非真的没办法（比如必须新增一个 route）。新增文件前先想"能不能加在已有文件里"。
- 不重命名变量、不调整无关格式、不"顺手优化"。
- 不加注释，除非这一处的 *为什么* 不显然。
- 不加超出需求的错误处理、fallback、feature flag。

`AGENTS.md` 提醒：这是定制版 Next.js，API/约定可能与训练数据不同。涉及 Next.js 框架行为时先翻 `node_modules/next/dist/docs/`，不要凭记忆写。

### 3. 跑"测试"（lint + build）

依次执行：

```bash
npm run lint
npm run build
```

**两个都必须没有 error 才算通过**（lint warning 可接受，但要在汇报时提一下；build 必须 exit 0）。

如果失败：
- 先读懂报错，定位是不是自己的改动引入的。
- 若是自己引入的，修掉它，再跑一遍。
- 若怀疑是历史遗留问题（改动前就坏的），先跑 `git stash && npm run build` 验证 baseline，确认后向用户报告"改动前就坏了"，不要试图顺手修。

### 4. 提交

用 conventional commits 风格，贴合最近的提交习惯（看 `git log --oneline -10`，常见前缀有 `feat:` / `fix:` / `perf:` / `refactor:`）。消息聚焦"为什么"，1-2 句话。

```bash
git add <具体文件>     # 不要用 git add -A
git commit -m "$(cat <<'EOF'
<type>: <一句话描述>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

提交后跑 `git status` 确认干净。**不要 push，不要建 PR**，除非用户明说。

### 5. 汇报

简短告诉用户：改了哪个文件、几行 diff、lint/build 结果、commit hash。一两句话。

## 中止条件

任何一条触发都立即停下，向用户说明，等指示：

- 第 1 步发现需求超出"小改动"边界。
- 第 3 步 lint/build 失败且原因不明。
- 用户描述本身有歧义、有多种合理实现路径——这种情况下先问一句再动手，比改完才发现方向错了便宜得多。
