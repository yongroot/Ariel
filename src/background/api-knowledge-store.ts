/**
 * Ariel 接口知识库 — 存储层
 *
 * 所有持久化操作通过 chrome.storage.local
 * 按 site 隔离，支持配额淘汰
 */

import type {
  ApiKnowledgeBase,
  ApiRecipe,
  ApiWorkflow,
  SiteAuth,
  CapturedRequest,
} from '../shared/api-knowledge-types';

const STORAGE_KEY = 'ariel_api_kb';

/** 每个 site 的最大 recipe 数 */
const MAX_RECIPES_PER_SITE = 50;

/** chrome.storage.local 总配额警告阈值（bytes） */
const STORAGE_QUOTA_WARNING = 8 * 1024 * 1024; // 8MB（上限 10MB）

// ============================================================
// Knowledge Base CRUD
// ============================================================

/** 获取完整知识库 */
export async function getKnowledgeBase(): Promise<ApiKnowledgeBase> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (result[STORAGE_KEY]) {
    return result[STORAGE_KEY] as ApiKnowledgeBase;
  }
  return {
    version: 1,
    sites: {},
    recipes: {},
    workflows: {},
    learning_mode: false,
  };
}

/** 保存完整知识库 */
export async function saveKnowledgeBase(kb: ApiKnowledgeBase): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: kb });
}

/** 检查学习模式是否开启 */
export async function isLearningMode(): Promise<boolean> {
  const kb = await getKnowledgeBase();
  return kb.learning_mode;
}

/** 切换学习模式 */
export async function setLearningMode(enabled: boolean): Promise<void> {
  const kb = await getKnowledgeBase();
  kb.learning_mode = enabled;
  await saveKnowledgeBase(kb);
}

// ============================================================
// SiteAuth
// ============================================================

export async function getSiteAuth(site: string): Promise<SiteAuth | null> {
  const kb = await getKnowledgeBase();
  return kb.sites[site] ?? null;
}

export async function saveSiteAuth(auth: SiteAuth): Promise<void> {
  const kb = await getKnowledgeBase();
  kb.sites[auth.site] = auth;
  await saveKnowledgeBase(kb);
}

/** 获取所有已配置的站点列表 */
export async function getAllSites(): Promise<string[]> {
  const kb = await getKnowledgeBase();
  return Object.keys(kb.sites);
}

// ============================================================
// ApiRecipe
// ============================================================

export async function getRecipe(id: string): Promise<ApiRecipe | null> {
  const kb = await getKnowledgeBase();
  return kb.recipes[id] ?? null;
}

/** 获取某站点的所有 recipe */
export async function getRecipesBySite(site: string): Promise<ApiRecipe[]> {
  const kb = await getKnowledgeBase();
  return Object.values(kb.recipes).filter((r) => r.site === site);
}

/** 保存 recipe（新建或更新） */
export async function saveRecipe(recipe: ApiRecipe): Promise<void> {
  const kb = await getKnowledgeBase();

  // 检查该 site 的 recipe 数量
  const siteRecipes = Object.values(kb.recipes).filter((r) => r.site === recipe.site);
  const isNew = !kb.recipes[recipe.id];

  if (isNew && siteRecipes.length >= MAX_RECIPES_PER_SITE) {
    // 淘汰最久未用的 recipe
    await evictOldestRecipe(kb, recipe.site);
  }

  kb.recipes[recipe.id] = recipe;
  await saveKnowledgeBase(kb);
}

/** 删除 recipe */
export async function deleteRecipe(id: string): Promise<void> {
  const kb = await getKnowledgeBase();

  // 清除其他 recipe 中对该 recipe 的 related 引用
  for (const recipe of Object.values(kb.recipes)) {
    if (recipe.related?.depends_on?.includes(id)) {
      recipe.related.depends_on = recipe.related.depends_on.filter((rid) => rid !== id);
    }
    if (recipe.related?.detail_of === id) {
      delete recipe.related.detail_of;
    }
  }

  delete kb.recipes[id];
  await saveKnowledgeBase(kb);
}

/** 更新 recipe 的使用统计 */
export async function updateRecipeStats(
  id: string,
  success: boolean,
): Promise<void> {
  const kb = await getKnowledgeBase();
  const recipe = kb.recipes[id];
  if (!recipe) return;

  recipe.use_count += 1;
  recipe.last_used = Date.now();

  // 指数移动平均更新 reliability
  const alpha = 0.1;
  recipe.reliability = recipe.reliability * (1 - alpha) + (success ? 1 : 0) * alpha;

  await saveKnowledgeBase(kb);
}

// ============================================================
// ApiWorkflow
// ============================================================

export async function getWorkflow(id: string): Promise<ApiWorkflow | null> {
  const kb = await getKnowledgeBase();
  return kb.workflows[id] ?? null;
}

export async function getWorkflowsBySite(site: string): Promise<ApiWorkflow[]> {
  const kb = await getKnowledgeBase();
  return Object.values(kb.workflows).filter((w) => w.site === site);
}

export async function saveWorkflow(workflow: ApiWorkflow): Promise<void> {
  const kb = await getKnowledgeBase();
  kb.workflows[workflow.id] = workflow;
  await saveKnowledgeBase(kb);
}

export async function deleteWorkflow(id: string): Promise<void> {
  const kb = await getKnowledgeBase();
  delete kb.workflows[id];
  await saveKnowledgeBase(kb);
}

// ============================================================
// 捕获数据临时存储（学习模式用）
// ============================================================

const CAPTURED_KEY = 'ariel_captured_requests';

/** 添加捕获的请求 */
export async function addCapturedRequest(req: CapturedRequest): Promise<void> {
  const result = await chrome.storage.local.get(CAPTURED_KEY);
  const captured: CapturedRequest[] = (result[CAPTURED_KEY] as CapturedRequest[] | undefined) ?? [];

  captured.push(req);

  // 保留最近 500 条
  if (captured.length > 500) {
    captured.splice(0, captured.length - 500);
  }

  await chrome.storage.local.set({ [CAPTURED_KEY]: captured });
}

/** 获取某 site 的所有捕获请求 */
export async function getCapturedRequests(site: string): Promise<CapturedRequest[]> {
  const result = await chrome.storage.local.get(CAPTURED_KEY);
  const captured: CapturedRequest[] = (result[CAPTURED_KEY] as CapturedRequest[] | undefined) ?? [];
  return captured.filter((r) => {
    try {
      const url = new URL(r.url);
      return getETLD1(url.hostname) === site;
    } catch {
      return false;
    }
  });
}

/** 清除捕获数据（分析完成后调用） */
export async function clearCapturedRequests(site?: string): Promise<void> {
  if (!site) {
    await chrome.storage.local.remove(CAPTURED_KEY);
    return;
  }

  const result = await chrome.storage.local.get(CAPTURED_KEY);
  const captured: CapturedRequest[] = (result[CAPTURED_KEY] as CapturedRequest[] | undefined) ?? [];
  const filtered = captured.filter((r) => {
    try {
      const url = new URL(r.url);
      return getETLD1(url.hostname) !== site;
    } catch {
      return true;
    }
  });
  await chrome.storage.local.set({ [CAPTURED_KEY]: filtered });
}

// ============================================================
// 导出 / 导入
// ============================================================

import type { KnowledgeBaseExport } from '../shared/api-knowledge-types';

/** 导出知识库（剥离敏感信息） */
export async function exportKnowledgeBase(): Promise<KnowledgeBaseExport> {
  const kb = await getKnowledgeBase();

  // 剥离敏感 headers
  const sanitizedSites: Record<string, Omit<SiteAuth, 'headers' | 'csrf'>> = {};
  for (const [site, auth] of Object.entries(kb.sites)) {
    sanitizedSites[site] = {
      version: auth.version,
      site: auth.site,
      auth_type: auth.auth_type,
      token_source: auth.token_source,
    };
  }

  return {
    version: 1,
    exported_at: Date.now(),
    sanitized: true,
    recipes: Object.values(kb.recipes).map((r) => ({
      ...r,
      // 剥离含认证关键字的 headers
      request: {
        ...r.request,
        headers_template: sanitizeHeaders(r.request.headers_template),
      },
    })),
    workflows: Object.values(kb.workflows),
    sites: sanitizedSites,
  };
}

/** 导入知识库 */
export async function importKnowledgeBase(data: KnowledgeBaseExport): Promise<number> {
  const kb = await getKnowledgeBase();
  let imported = 0;

  for (const recipe of data.recipes) {
    if (!kb.recipes[recipe.id]) {
      kb.recipes[recipe.id] = recipe;
      imported++;
    }
  }

  for (const workflow of data.workflows) {
    if (!kb.workflows[workflow.id]) {
      kb.workflows[workflow.id] = workflow;
      imported++;
    }
  }

  // 不导入 site auth（每个用户的认证方式不同）
  await saveKnowledgeBase(kb);
  return imported;
}

// ============================================================
// 辅助函数
// ============================================================

/** 淘汰最久未使用的 recipe */
async function evictOldestRecipe(kb: ApiKnowledgeBase, site: string): Promise<void> {
  const siteRecipes = Object.values(kb.recipes)
    .filter((r) => r.site === site)
    .sort((a, b) => a.last_used - b.last_used);

  if (siteRecipes.length > 0) {
    const toEvict = siteRecipes[0];
    // 清除悬空引用
    await deleteRecipe(toEvict.id);
  }
}

/** 获取 eTLD+1（简化版） */
export function getETLD1(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  // 简化处理：取最后两段
  // TODO: 处理 co.uk, com.cn 等特殊情况
  return parts.slice(-2).join('.');
}

/** 剥离含认证关键字的 headers */
function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sensitiveKeys = ['auth', 'token', 'key', 'session', 'cookie', 'authorization'];
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (!sensitiveKeys.some((s) => lower.includes(s))) {
      result[k] = v;
    }
  }
  return result;
}

/** 检查 URL 是否应该被过滤（不捕获） */
export function shouldFilterUrl(url: string): boolean {
  const filterPatterns = ['auth', 'login', 'token', 'password', 'session', 'oauth', 'sso', 'captcha'];
  const lower = url.toLowerCase();
  return filterPatterns.some((p) => lower.includes(p));
}

/** 生成精简的接口目录（给 LLM 看） */
export async function generateApiCatalog(site: string): Promise<string> {
  const recipes = await getRecipesBySite(site);
  const auth = await getSiteAuth(site);

  if (recipes.length === 0) return '';

  const lines: string[] = [];
  lines.push(`站点: ${site}`);
  lines.push(`认证: ${auth ? '✅ ' + auth.auth_type : '❌ 未配置'}`);
  lines.push('');
  lines.push('可用接口:');

  recipes.forEach((r, i) => {
    const safety = r.safe ? '✅只读' : '⚠️写操作，需确认';
    lines.push(`${i + 1}. [${r.id}] ${r.name} - ${r.description}`);

    const params = r.params
      .filter((p) => p.required || p.enum)
      .map((p) => {
        let s = p.name;
        if (p.required) s += '(必填)';
        else s += '(可选)';
        if (p.enum) s += `:${p.enum.join('/')}`;
        return s;
      });
    if (params.length > 0) {
      lines.push(`   参数: ${params.join(', ')}`);
    }

    lines.push(`   ${safety}`);

    if (r.related?.detail_of) {
      lines.push(`   关联: ${r.related.detail_of} 的详情`);
    }

    lines.push('');
  });

  return lines.join('\n');
}
