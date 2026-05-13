# Ariel 接口知识库 — 设计文档

> 经过 3 轮 SubAgent 攻击验证，方案已通过。

## 产品定位

Ariel 的接口知识库是 **增强能力**，不是前提。即使知识库为空，Ariel 仍可通过 page_read + captured_api（会话级别）工作。知识库的价值在于让 Ariel **不依赖用户当前打开的页面**。

## 核心架构：三层分离

```
LLM 上下文层  ← 只看精简接口目录（~200-500 token）
    │ 按需调用
工具调用层    ← 确定性的 invoke_api(recipe_id, params)
    │ 读取
知识库层      ← chrome.storage.local，按站点隔离
```

## Schema 定义

### SchemaVersion

所有持久化结构包含 `version: 1` 字段，用于数据迁移。

### SiteAuth

```typescript
interface SiteAuth {
  version: 1;
  site: string;  // eTLD+1，子域共享。如 api.example.com → example.com

  auth_type: 'cookie' | 'bearer' | 'custom_header';
  token_source: {
    type: 'cookie' | 'localStorage' | 'response_header' | 'meta_tag';
    key: string;
    extract_pattern?: string;
  };
  headers: Record<string, string>;

  // CSRF 配置（站点级）
  csrf?: {
    token_source: {
      type: 'meta_tag' | 'cookie' | 'response_header';
      key: string;
    };
    inject_to: 'header' | 'body';
    inject_key: string;
    cache_ttl: number;  // 秒，0 = 每次重新获取
  };
}
```

### ApiRecipe

```typescript
interface ApiRecipe {
  version: 1;

  // 标识与描述
  id: string;
  site: string;  // eTLD+1
  name: string;  // 人类可读，如「获取订单列表」
  description: string;  // 用途说明 + 适用场景
  limitations: string;  // 不适用场景、安全提示

  // 协议与安全
  protocol: 'rest' | 'graphql';
  safe: boolean;  // 只读操作？
  requires_confirmation: boolean;  // 写操作需用户确认

  // 请求模板
  request: {
    method: string;
    url_template: string;  // :param 风格，如 /api/users/:id/orders
    headers_template: Record<string, string>;
    body_template?: string | { query: string; variables_template: Record<string, string> };
    content_type?: 'json' | 'form-urlencoded';
  };

  // 参数定义（LLM 只看这部分来决定传什么）
  params: {
    name: string;
    type: 'path' | 'query' | 'body' | 'header';
    required: boolean;
    default?: string;
    description: string;
    enum?: string[];
    order?: number;  // path 参数替换顺序
  }[];

  // 响应结构
  response_shape: {
    description: string;  // 自然语言描述响应内容
    data_path: string;    // 数据所在路径，如 data.list
    pagination?: {
      type: 'offset' | 'cursor' | 'page';
      params: string[];    // 请求侧参数名
      next_path?: string;  // 响应侧下一页 token 路径，如 pagination.next_cursor
      total_path?: string; // 总数路径，如 pagination.total
    };
    error_indicators?: {
      http_status_range?: [number, number];  // 非 [200,299] 视为错误
      body_path?: string;     // 如 'code'
      error_values?: string[]; // 这些值表示错误
    };
  };

  // 关联关系
  related?: {
    depends_on?: string[];  // 前置接口 id
    detail_of?: string;     // 是哪个列表接口的详情
  };

  // 元数据
  captured_at: number;
  last_used: number;
  use_count: number;
  verified: boolean;
  reliability: number;  // 0-1，成功率
  api_version?: string;
}
```

### ApiWorkflow

```typescript
interface ApiWorkflow {
  version: 1;
  id: string;
  site: string;
  name: string;
  description: string;
  steps: {
    recipe_id: string;
    fixed_params: Record<string, string>;
    bindings: Record<string, string>;  // "$N.data_path" 语法引用第 N 步响应
  }[];
}
// 失败策略：任一 step 失败则整个 workflow 中止，返回失败 step 的错误信息
```

## 核心工具：invoke_api

```typescript
async function invoke_api(recipe_id: string, params: Record<string, string>): Promise<any> {
  // 1. 从知识库读取完整 recipe（LLM 不参与）
  // 2. 从 SiteAuth 获取认证信息 + CSRF token（如有）
  // 3. 模板替换构造请求（纯字符串操作，零 AI）
  //    url: :param → params[param]
  //    body: JSON template → params 替换
  //    graphql: {query, variables_template} → 替换 variables
  // 4. 在用户浏览器上下文中 fetch（继承 cookie）
  // 5. 按 response_shape 提取数据
  // 6. 更新 use_count / last_used / reliability
}
```

## LLM 上下文注入

LLM 看到的精简目录（system prompt 中注入）：

```
站点: orders.example.com
认证: ✅ cookie (自动)
可用接口:
1. [get_orders] 获取订单列表 - 分页，默认最近20条
   参数: status(可选:pending/completed), page, page_size
   ✅只读
2. [get_order_detail] 获取订单详情
   参数: order_id(必填)
   关联: get_orders 的详情
   ✅只读
3. [cancel_order] 取消订单
   参数: order_id(必填), reason
   ⚠️写操作，需确认
```

## 关键设计决策

1. **学习模式**（非「开发者模式」）：默认关闭，开启后自动捕获分析
2. **自动积累提示**：即使未开启学习模式，识别到高频接口时提示用户
3. **默认过滤**：URL 含 auth/login/token/password/session 不捕获
4. **不存真实数据**：分析完成后丢弃原始 request/response body
5. **CSRF 在 SiteAuth 层处理**
6. **写操作确认**：safe=false 的接口首次调用需用户确认
7. **失败处理**：明确告知失败原因 + 建议（如「请先打开 XX 页面」）
8. **API 限流**：同站点并发最多 3，间隔 200ms
9. **认证失效**：401 时提示用户刷新页面，不自动刷新 token
10. **存储淘汰**：按 site 配额，超出时按 last_used 淘汰，同步清除 related 悬空引用
11. **导出导入**：剥离含 auth/token/key/session 的 header，保留功能性 header
12. **数据溯源**：每个 API 调用的回答标注来源接口 + 查询时间

## 明确不支持（MVP）

- gRPC-Web / SSE / WebSocket
- 签名鉴权（预留 plugin 扩展点）
- 前端加密参数

## 开发计划

### Phase 0: Schema & 类型定义（1 天）
- TypeScript 类型文件
- 存储层接口（CRUD）
- Schema 版本管理

### Phase 1: 学习模式 - 被动捕获（2-3 天）
- 增强 content script 拦截，记录完整 request/response
- 存储到 chrome.storage.local（按 site 分组）
- 学习模式 UI：开关 + 捕获状态
- 默认过滤规则实现
- 验证：完整捕获真实接口

### Phase 2: 接口分析 & Recipe 生成（2-3 天）
- LLM 一次性分析：捕获数据 → ApiRecipe 草稿
- 分析 UI：展示结果，用户确认/编辑
- 验证：Recipe 准确描述接口

### Phase 3: invoke_api 工具（2-3 天）
- 模板替换引擎
- SiteAuth 认证注入 + CSRF 处理
- 精简目录生成 + LLM prompt 注入
- 参数校验 + 错误处理
- 写操作确认 UI
- 限流机制
- 验证：完整重放 + 参数微调

### Phase 4: 接口编排（2 天）
- ApiWorkflow 类型 + 存储
- Binding 表达式解析器（$N.path 语法）
- Workflow 编辑 UI
- 失败中止策略
- 验证：连续调用依赖接口

### Phase 5: 主动调用 & 体验（2-3 天）
- 端到端：自然语言 → 接口选择 → 调用 → 结果
- 数据溯源标注
- 知识库导出导入
- 自动积累提示
- 存储淘汰机制
- 可靠性追踪
- 验证：首页提问完整闭环
