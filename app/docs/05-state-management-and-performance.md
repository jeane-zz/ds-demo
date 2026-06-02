# 前端状态管理与性能优化方案

> 关键词：Hooks 驱动 · TaskQueue 串行 · useRef 防闭包 · rAF 节流 · 虚拟列表 · memo 精细化

---

## 1. 问题与目标

项目是一个**实时对话应用**，对前端状态管理的要求：
1. 流式响应需要频繁更新 UI（每 16ms 都可能写入新 token）
2. 多个异步操作可能并发（send / regenerate / compress）
3. 闭包陷阱：useState 异步更新导致回调中拿到过期数据
4. 消息列表可能很长（数百条），需要虚拟化渲染

## 2. 状态管理模式

不使用 Redux / Zustand / Jotai 等外部状态库，而是采用 **React Hooks + refs + 任务队列** 的组合。

### 2.1 核心 Hook：`useSessionWithDB`

这是项目中**最复杂的 Hook**，管理所有对话状态：

| 状态 | 类型 | 用途 |
|------|------|------|
| `sessions` | `Session[]` | 会话列表（排序后） |
| `activeId` | `string` | 当前活跃会话 ID |
| `messages` | `Message[]` | 当前会话的消息数组 |
| `streamingIndex` | `number \| null` | 正在流式写入的消息索引 |
| `migration` | `MigrationState` | 数据迁移进度反馈 |

### 2.2 useRef 解决闭包过期

**问题**：React 中 useEffect/useCallback 的回调里读取的 state 可能不是最新值。

**方案**：用 ref 保存最新 state 的副本：

```typescript
const sessionsRef = useRef<Session[]>([]);
const messagesRef = useRef<Message[]>([]);
const activeIdRef = useRef("");

useEffect(() => {
  sessionsRef.current = sessions;
}, [sessions]);

useEffect(() => {
  messagesRef.current = messages;
}, [messages]);
```

在 send / regenerate / compress 等异步操作中，通过 `messagesRef.current` 获取最新消息数组，避免闭包过期。

**典型场景**：`send()` 中的 `streamAssistant` 调用了父级 `trimContext` 和 `generateTitle`，这些函数如果只用 state 闭包，在异步执行时拿到的可能是旧数据。

## 3. TaskQueue：串行任务调度

### 3.1 问题

两个并发场景会导致竞态：
1. 正在 streaming 时用户点击 regenerate
2. 正在 streaming 时用户点击 compress

如果在 streaming 进行中同时执行 compress，消息数组的索引会错位，导致 UI 混乱。

### 3.2 解决方案

```typescript
// app/lib/taskQueue.ts

export class TaskQueue {
  private chain: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(() => task());
    // 关键：前一个任务失败（reject）不影响后续任务
    this.chain = next.then(
      () => undefined,
      () => undefined  // 捕获 reject，不阻断链
    );
    return next;
  }
}
```

**使用方式**：
```typescript
const queueRef = useRef<TaskQueue>(null as unknown as TaskQueue);
if (queueRef.current === null) queueRef.current = new TaskQueue();

// send 和 regenerate 都通过 queue 执行
await queueRef.current.run(async () => {
  await streamAssistant(...);
});
```

**FIFO 特性**：任务按调用顺序串行执行，前一个完成后才启动下一个。

## 4. 乐观更新策略

所有数据变更都遵循**先改 UI 再持久化**的乐观更新模式：

```typescript
// send 中的乐观更新
setMessages(nextMessages);                    // 1. 立即更新 UI
setStreamingIndex(assistantVisibleIndex);      // 2. 显示占位符

await storage.bulkCreateMessages([userMsg, assistantMsg]);  // 3. 异步持久化

await queueRef.current.run(async () => {
  const finalText = await streamAssistant(...);  // 4. 流式写入
  await storage.updateMessage(assistantMsg.id, { content: finalText }); // 5. 持久化最终结果
});
```

**优势**：
- 用户输入后立即看到自己的消息，没有网络延迟
- 持续看到 AI 逐字生成，体验流畅

## 5. 流式响应的 rAF 节流

### 5.1 问题

fetch ReadableStream 的 `read()` 在快速网络下可能以毫秒级频率产生数据块。如果每块都 `setState` 一次，会触发大量 React 重渲染。

### 5.2 方案

```typescript
let pendingText = "";
let rafId: number | null = null;
let hasPending = false;

const flush = () => {
  if (!hasPending) return;
  const snapshot = pendingText;
  hasPending = false;
  setMessages((current) =>
    current.map((msg) =>
      msg.id === targetId ? { ...msg, content: snapshot } : msg
    )
  );
  scrollToBottom();
};

const scheduleFlush = () => {
  if (rafId !== null) return;  // 已有待处理的 rAF
  rafId = requestAnimationFrame(() => {
    rafId = null;
    flush();
  });
};

// 每次 read 后
assistantText += decoder.decode(value, { stream: true });
pendingText = assistantText;
hasPending = true;
scheduleFlush();
```

**效果**：
- 每帧（~16ms）最多更新一次 UI
- 数据持续累积到 `pendingText`，不会丢
- 帧末 `flush()` 一次性写入最新文本

## 6. 虚拟化渲染

### 6.1 阈值判断

```typescript
const VIRTUALIZE_THRESHOLD = 30;
const useVirtual = visibleMessages.length > VIRTUALIZE_THRESHOLD;
```

### 6.2 两种渲染路径

```typescript
// app/page.tsx
{isMounted && !useVirtual && (
  // 普通渲染：直接用 map 渲染所有消息
  visibleMessages.map((msg, index) => (
    <div key={index} id={`${activeId}-${index}`}>
      <MessageItem ... />
    </div>
  ))
  <div ref={bottomRef}></div>
)}

{isMounted && useVirtual && (
  <Virtuoso
    ref={virtuosoRef}
    style={{ height: "100%" }}
    data={visibleMessages}
    followOutput="auto"          // 新消息自动滚到底部
    initialTopMostItemIndex={Math.max(0, visibleMessages.length - 1)}
    computeItemKey={(index) => `${activeId}-${index}`}
    itemContent={(index, msg) => (
      <MessageItem ... />
    )}
  />
)}
```

**`bottomRef` 的处理**：虚拟化模式下，Virtuoso 的 `followOutput="auto"` 接管了自动滚到底部的行为。

## 7. memo 精细化

### 7.1 SessionItem

```typescript
const SessionItem = memo(function SessionItem({ session, isActive, onSelect, ... }) {
  // ...
},
// 自定义比较函数：只比较 id / title / pinned，引用变化不重渲染
(prev, next) =>
  prev.isActive === next.isActive &&
  prev.session.id === next.session.id &&
  prev.session.title === next.session.title &&
  prev.session.pinned === next.session.pinned &&
  prev.onSelect === next.onSelect &&
  prev.onRename === next.onRename &&
  prev.onDelete === next.onDelete &&
  prev.onTogglePin === next.onTogglePin);
```

**关键**：发送消息时 `sessions` 数组会产生新引用（updatedAt 变了），但 `SessionItem` 只依赖 `{id, title, pinned}`，通过自定义比较跳过渲染。

### 7.2 稳定回调

```typescript
// page.tsx 中生成稳定的 handler
const handleSelectSession = useCallback(
  (id: string) => switchSession(id),
  [switchSession]
);
// 同样对 handleRenameSession / handleDeleteSession / handleTogglePinSession
```

```typescript
// 把 onSelect / onRename 等作为 props 传递给 SessionItem
<SessionItem
  key={s.id}
  onSelect={handleSelectSession}  // 引用不变
  onRename={handleRenameSession}  // 引用不变
  ...
/>
```

## 8. 首屏渲染优化

### 8.1 SSR 安全

```typescript
const [isMounted, setIsMounted] = useState(false);

useEffect(() => {
  setIsMounted(true);
}, []);

// 渲染时
{isMounted && !useVirtual && (...)}
```

`useSessionWithDB` 的初始值是空数组/空字符串，首屏渲染一个空状态。只有 `isMounted` 后才显示真实内容，避免 hydrate 不匹配。

### 8.2 主题 FOUC 防止

```html
<!-- layout.tsx -->
<script dangerouslySetInnerHTML={{
  __html: `
    (function() {
      try {
        var theme = localStorage.getItem('theme');
        if (!theme) {
          theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', theme);
      } catch(e) {}
    })();
  `,
}} />
```

内联脚本在 React hydrate 前执行，立即设置 `data-theme`，避免闪白/闪黑。

## 9. 性能指标汇总

| 优化点 | 效果 |
|--------|------|
| rAF 节流 | UI 更新频率从 ~1ms 降到 ~16ms |
| 虚拟化渲染 | 消息列表 > 30 条时只渲染可见区域 |
| SessionItem memo | 发送消息时不重渲染未变更的会话项 |
| 稳定回调 | 避免子组件因回调引用变化而重渲染 |
| 乐观更新 | UI 响应无网络延迟 |
| TaskQueue 串行 | 避免 streaming/compress 竞态导致消息错位 |
| useRef 副本 | 闭包回调中始终能拿到最新数据 |
| MiniLM 单例 | 嵌入模型只加载一次（~23MB） |