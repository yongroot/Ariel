/**
 * Ariel 接口知识库 — 类型定义
 *
 * 设计文档：docs/api-knowledge-base-design.md
 * Schema version: 1
 */

// ============================================================
// Site-level Authentication
// ============================================================

export interface SiteAuth {
  version: 1;
  /** eTLD+1 注册域名，所有子域共享。如 api.example.com → example.com */
  site: string;
  auth_type: 'cookie' | 'bearer' | 'custom_header';
  token_source: {
    type: 'cookie' | 'localStorage' | 'response_header' | 'meta_tag';
    /** cookie 名 / storage key / header 名 / meta name */
    key: string;
    /** 可选的正则提取 */
    extract_pattern?: string;
  };
  /** 附加到每个请求的固定 headers */
  headers: Record<string, string>;
  /** CSRF 配置（站点级） */
  csrf?: {
    token_source: {
      type: 'meta_tag' | 'cookie' | 'response_header';
      key: string;
    };
    /** CSRF token 注入到 header 还是 body */
    inject_to: 'header' | 'body';
    /** header 名或 body 字段名，如 'X-CSRF-Token' */
    inject_key: string;
    /** 缓存秒数，0 = 每次重新获取 */
    cache_ttl: number;
  };
}

// ============================================================
// API Recipe
// ============================================================

export interface ApiParam {
  name: string;
  type: 'path' | 'query' | 'body' | 'header';
  required: boolean;
  default?: string;
  /** 自然语言描述，帮助 LLM 理解参数含义 */
  description: string;
  /** 可选值列表 */
  enum?: string[];
  /** path 参数在 URL 中的替换顺序 */
  order?: number;
}

export interface ApiRecipe {
  version: 1;

  // --- 标识与描述 ---
  id: string;
  /** eTLD+1 */
  site: string;
  /** 人类可读名称 */
  name: string;
  /** 用途说明 + 适用场景 */
  description: string;
  /** 不适用场景、安全提示 */
  limitations: string;

  // --- 协议与安全 ---
  protocol: 'rest' | 'graphql';
  /** 只读操作？GET/HEAD 通常为 true */
  safe: boolean;
  /** 写操作需用户确认 */
  requires_confirmation: boolean;

  // --- 请求模板 ---
  request: {
    method: string;
    /** :param 风格，如 /api/users/:id/orders */
    url_template: string;
    headers_template: Record<string, string>;
    /**
     * REST: JSON 字符串模板，{param} 占位符
     * GraphQL: { query: string, variables_template: Record<string, string> }
     */
    body_template?: string | { query: string; variables_template: Record<string, string> };
    content_type?: 'json' | 'form-urlencoded';
  };

  // --- 参数定义 ---
  params: ApiParam[];

  // --- 响应结构 ---
  response_shape: {
    /** 自然语言描述响应内容 */
    description: string;
    /** 数据所在路径，如 data.list */
    data_path: string;
    pagination?: {
      type: 'offset' | 'cursor' | 'page';
      /** 请求侧参数名 */
      params: string[];
      /** 响应侧下一页 token 路径，如 pagination.next_cursor */
      next_path?: string;
      /** 总数路径，如 pagination.total */
      total_path?: string;
    };
    error_indicators?: {
      /** HTTP status 范围，非此范围视为错误。默认 [200, 299] */
      http_status_range?: [number, number];
      /** body 中错误码路径，如 'code' */
      body_path?: string;
      /** 这些值表示错误 */
      error_values?: string[];
    };
  };

  // --- 关联关系 ---
  related?: {
    /** 前置接口 id */
    depends_on?: string[];
    /** 是哪个列表接口的详情 */
    detail_of?: string;
  };

  // --- 元数据 ---
  captured_at: number;
  last_used: number;
  use_count: number;
  verified: boolean;
  /** 成功率 0-1 */
  reliability: number;
  api_version?: string;
}

// ============================================================
// API Workflow（接口编排）
// ============================================================

export interface WorkflowStep {
  recipe_id: string;
  /** 固定参数 */
  fixed_params: Record<string, string>;
  /**
   * 动态绑定表达式。语法："$N.data_path"
   * N = step 索引（0-based），data_path = 响应中的取值路径
   * 例：{ order_id: "$0.data.list[0].id" }
   */
  bindings: Record<string, string>;
}

export interface ApiWorkflow {
  version: 1;
  id: string;
  site: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}

// ============================================================
// Knowledge Base（知识库整体结构）
// ============================================================

export interface ApiKnowledgeBase {
  version: 1;
  /** 站点认证配置，key = site (eTLD+1) */
  sites: Record<string, SiteAuth>;
  /** 所有 recipe，key = recipe id */
  recipes: Record<string, ApiRecipe>;
  /** 所有 workflow，key = workflow id */
  workflows: Record<string, ApiWorkflow>;
  /** 学习模式是否开启 */
  learning_mode: boolean;
}

// ============================================================
// 捕获原始数据（分析前的临时结构）
// ============================================================

export interface CapturedRequest {
  /** 捕获时间戳 */
  captured_at: number;
  /** 请求 URL */
  url: string;
  /** HTTP 方法 */
  method: string;
  /** 请求 headers */
  request_headers: Record<string, string>;
  /** 请求 body（字符串） */
  request_body?: string;
  /** 响应 status */
  response_status: number;
  /** 响应 headers */
  response_headers: Record<string, string>;
  /** 响应 body（截断到合理大小） */
  response_body?: string;
  /** 所属 tab */
  tab_id: number;
}

// ============================================================
// 工具调用参数
// ============================================================

export interface InvokeApiParams {
  recipe_id: string;
  params: Record<string, string>;
}

export interface InvokeApiResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /** 调用的 recipe id */
  recipe_id: string;
  /** 实际请求的 URL */
  actual_url: string;
  /** 响应 status */
  status: number;
  /** 是否需要用户确认（写操作） */
  needs_confirmation?: boolean;
}

// ============================================================
// 导出/导入
// ============================================================

export interface KnowledgeBaseExport {
  version: 1;
  exported_at: number;
  /** 导出时剥离了认证相关字段 */
  sanitized: true;
  recipes: Omit<ApiRecipe, never>[];
  workflows: ApiWorkflow[];
  /** SiteAuth 导出时剥离敏感 headers */
  sites: Record<string, Omit<SiteAuth, 'headers' | 'csrf'>>;
}
