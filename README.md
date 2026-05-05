# Ariel

> 取自莎士比亚《暴风雨》中的 Ariel——轻盈、敏捷、无处不在。正如 Ariel 为普洛斯彼罗服务于整座岛屿，这个扩展为你服务于每一个网页。

Chrome MV3 扩展，Side Panel 形态的 AI 助手。捕获页面 DOM 和 API 请求，通过自然语言对话分析网页内容。

## 功能

- **Side Panel 对话** — 流式 LLM 响应，完整 Markdown 渲染和代码高亮
- **页面检查** — 读取 DOM 内容，提取任意网页的结构化数据
- **API 拦截** — 自动捕获 fetch/XHR 请求，存储并支持查询
- **数据分析** — 对拦截到的 API 响应做 filter / count / groupby / sum 等聚合操作
- **自适应主题** — UI 颜色自动跟随当前网站背景色
- **多会话管理** — 支持新建、切换、删除、标星会话，显示起止时间

## 工具

| 工具 | 描述 |
|------|------|
| `page_inspect` | 获取页面结构、标题、链接、元数据 |
| `page_read` | 按 CSS 选择器提取 DOM 内容 |
| `captured_api` | 查询拦截到的 API 请求（支持 URL/方法/状态码过滤） |
| `analyze_data` | 对 API 响应体做结构化分析（filter/count/sum/avg/min/max/groupby/unique/top） |

## 安装

### 前置条件

- Node.js 18+
- Chrome 或兼容浏览器
- OpenAI 兼容的 API Key

### 构建

```bash
npm install
npm run build
```

### 加载扩展

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `dist/` 目录

### 配置

点击侧栏的齿轮图标设置：
- **API Key** — OpenAI 兼容的 API Key
- **Base URL** — API 端点（默认 `https://api.openai.com/v1`）
- **Model** — 模型名称（默认 `gpt-4o`）

## 开发

```bash
npm run dev          # 构建并监听变更
npm run build        # 生产构建
npm run typecheck    # TypeScript 类型检查
npm run test         # 单元测试
npm run test:e2e     # Playwright E2E 测试
```

## 技术栈

- **Vite 8** — 构建工具
- **React 19** — UI 框架
- **Tailwind CSS v4** — 样式（含 @tailwindcss/typography）
- **marked + highlight.js** — Markdown 渲染和代码高亮
- **TypeScript** — 类型安全
- **Chrome MV3** — 扩展架构

## 架构

```
src/
├── background/              # Service Worker
│   ├── index.ts             # 消息路由、主题缓存
│   ├── llm.ts               # LLM 流式通信、工具执行循环
│   └── tools/               # 工具实现
│       ├── registry.ts      # 工具注册与分发
│       ├── page-tools.ts    # inspect / read
│       ├── captured-api.ts  # API 请求拦截存储与查询
│       └── analyze-data.ts  # 结构化数据分析
├── content/                 # Content Scripts
│   ├── index.ts             # MAIN world 入口
│   ├── bridge.ts            # 消息桥
│   ├── handlers.ts          # fetch/XHR 拦截、主题采样
│   └── dom-utils.ts         # DOM 工具
├── sidepanel/               # Side Panel UI（React）
│   ├── App.tsx              # 顶栏、视图路由、主题应用
│   ├── components/          # ChatPanel, MessageBubble, InputBar
│   └── styles/              # Tailwind + prose 覆写 + 主题变量
└── shared/                  # 共享类型与常量
    ├── types.ts
    ├── protocol.ts
    ├── theme.ts             # HSL 色轮调色板生成
    └── constants.ts
```

## License

[Apache-2.0](LICENSE)
