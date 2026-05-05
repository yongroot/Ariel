# Ariel

Chrome MV3 扩展，Side Panel 形态的 AI 助手。捕获页面 DOM 和 API 请求，通过自然语言对话分析网页内容。

## 技术栈

- TypeScript, Vite 8, vite-plugin-web-extension
- React 19 + Tailwind CSS v4 + @tailwindcss/typography
- marked + highlight.js（Markdown 渲染）
- Zod（运行时校验）
- vitest（单元测试）, Playwright（E2E）

## 构建

```bash
npm run dev          # vite build --watch
npm run build        # 生产构建 → dist/
npm run typecheck    # tsc --noEmit（2 个预存 TS 错误可忽略：PAGE_THEME、MarkedOptions）
npm run test         # vitest
npm run test:e2e     # Playwright
```

Chrome 加载：`chrome://extensions` → 开发者模式 → 加载已解压 → 选 `dist/`。

## 架构

```
src/
├── manifest.json
├── sidepanel/              # Side Panel UI（React）
│   ├── index.html
│   ├── main.tsx
│   ├── App.tsx             # 顶栏（新建/历史/设置）、视图路由、自适应主题
│   ├── components/
│   │   ├── ChatPanel.tsx   # 对话面板、会话管理（新建/切换/删除/标星）、消息列表
│   │   ├── MessageBubble.tsx  # 消息渲染：Markdown、代码高亮、复制按钮、工具调用卡片
│   │   └── InputBar.tsx    # 输入栏（自适应发送/终止图标）
│   └── styles/
│       └── index.css       # Tailwind 入口 + prose 自定义 + 主题变量
├── background/             # Service Worker
│   ├── index.ts            # 消息路由、主题缓存、content script 桥接
│   ├── llm.ts              # OpenAI 兼容 API 流式通信、tool execution loop
│   └── tools/
│       ├── registry.ts     # 工具注册与分发（4 个工具）
│       ├── page-tools.ts   # inspect（页面结构）、read（DOM 内容提取）
│       ├── captured-api.ts # API 请求拦截存储与查询
│       └── analyze-data.ts # 结构化数据分析（filter/count/groupby/sum/avg 等）
├── content/                # Content Scripts
│   ├── bridge.ts           # MAIN world → content script 消息桥
│   ├── dom-utils.ts        # DOM 工具函数
│   ├── handlers.ts         # fetch/XHR 拦截、主题采样
│   └── index.ts            # MAIN world 入口
└── shared/
    ├── types.ts            # Message, Session, Settings, ToolDefinition 等类型
    ├── protocol.ts         # PanelMessage / StreamEvent 消息协议
    ├── theme.ts            # HSL 色轮调色板生成 + applyPalette
    └── constants.ts        # storage keys
```

## 工具（4 个）

| 工具 | 描述 |
|------|------|
| `page_inspect` | 页面结构、标题、链接、元数据 |
| `page_read` | 按 CSS 选择器提取 DOM 内容 |
| `captured_api` | 查询拦截到的 API 请求（支持 URL/方法/状态码过滤） |
| `analyze_data` | 对 captured API 响应体做结构化分析（filter/count/sum/avg/min/max/groupby/unique/top） |

## 消息协议

SidePanel ↔ Service Worker：`chrome.runtime.sendMessage` / `chrome.runtime.onMessage`

```ts
// SidePanel → SW
type PanelMessage =
  | { type: 'CHAT_SEND'; content: string }
  | { type: 'CHAT_ABORT' }
  | { type: 'GET_PAGE_CONTEXT' }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Settings }

// SW → SidePanel (流式)
type StreamEvent =
  | { type: 'TEXT_DELTA'; content: string }
  | { type: 'REASONING_DELTA'; content: string }
  | { type: 'TOOL_CALL'; toolCallId: string; name: string; args: object }
  | { type: 'TOOL_RESULT'; toolCallId: string; result: unknown; error?: string }
  | { type: 'DONE' }
  | { type: 'ERROR'; message: string }
```

## 主题系统

CSS 变量驱动（`--ap-*` 前缀），`theme.ts` 从页面背景色 RGB 自动生成完整调色板。
支持深色/浅色自适应，用户气泡在浅色模式用浅底深字，深色模式用深底浅字。

## 数据获取优先级

数据分析任务中，目标数据如果存在于列表、表格等需要滚动加载的场景，必须优先使用 `captured_api` 或 `analyze_data` 工具获取 API 接口数据，而不是 `page_read` 解析页面 DOM。

原因：DOM 解析只能获取当前视口已渲染的内容，API 响应体包含完整结构化数据。

## 关键设计决策

- 会话存储用 `chrome.storage.local`（Session 数组 + activeId），不用 IndexedDB
- API 拦截在 MAIN world 注入，通过 bridge.ts 转发到 content script → service worker
- Markdown 渲染用 marked 自定义 renderer，代码块在 HTML 生成阶段嵌入 header + 复制按钮（避免 useEffect DOM 操作）
- analyze_data 直接从内存中的完整响应体读取，不经过 captured_api 的 2000 字符截断
