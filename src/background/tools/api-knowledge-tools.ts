/**
 * 接口知识库工具 — analyze_apis + manage_knowledge
 *
 * 供 LLM 在对话中调用，分析和查询接口知识
 */

import type { ToolDefinition } from '../../shared/types';
import type { ApiRecipe, ApiWorkflow, KnowledgeBaseExport } from '../../shared/api-knowledge-types';
import {
  getCapturedRequests,
  clearCapturedRequests,
  getRecipesBySite,
  saveRecipe,
  deleteRecipe,
  getRecipe,
  exportKnowledgeBase,
  importKnowledgeBase,
  getAllSites,
  generateApiCatalog,
  getWorkflowsBySite,
  saveWorkflow,
  deleteWorkflow,
} from '../api-knowledge-store';
import { analyzeRequests } from './api-analyzer';

// ============================================================
// analyze_apis
// ============================================================

export const analyzeApisTool: ToolDefinition = {
  name: 'analyze_apis',
  description:
    '分析当前站点已捕获的 API 接口，生成接口知识条目（ApiRecipe 草稿）。' +
    '在学习模式下，当用户请求分析接口、总结 API、整理接口文档时使用。' +
    '分析基于确定性的启发式规则，不修改已有知识库。',
  parameters: {
    type: 'object',
    properties: {
      site: {
        type: 'string',
        description: '要分析的站点域名（eTLD+1），如 example.com',
      },
    },
    required: ['site'],
  },
  execute: async (args) => {
    const site = args.site as string;

    const requests = await getCapturedRequests(site);
    if (requests.length === 0) {
      return {
        error: `没有找到 ${site} 的捕获数据`,
        hint: '请确保学习模式已开启，且已在目标站点上有过操作',
      };
    }

    const drafts = analyzeRequests(requests);

    if (drafts.length === 0) {
      return {
        error: '分析完成但未生成任何接口草稿',
        hint: '捕获的请求可能格式不标准',
        requestCount: requests.length,
      };
    }

    return {
      site,
      analyzed_requests: requests.length,
      recipes_generated: drafts.length,
      recipes: drafts.map((d) => ({
        id: d.recipe.id,
        name: d.recipe.name,
        description: d.recipe.description,
        method: d.recipe.request.method,
        url_template: d.recipe.request.url_template,
        safe: d.recipe.safe,
        protocol: d.recipe.protocol,
        params_count: d.recipe.params.length,
        has_pagination: !!d.recipe.response_shape.pagination,
        stats: d.stats,
      })),
      hint: '草稿已生成，使用 manage_knowledge(action="confirm") 保存到知识库',
    };
  },
};

// ============================================================
// manage_knowledge
// ============================================================

export const manageKnowledgeTool: ToolDefinition = {
  name: 'manage_knowledge',
  description:
    '管理接口知识库：查看已掌握的接口、确认分析草稿、删除知识条目、导出/导入知识库。' +
    'confirm 操作会将 analyze_apis 生成的草稿保存为正式知识条目。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'confirm', 'delete', 'export', 'import', 'analyze_and_confirm',
               'list_workflows', 'create_workflow', 'delete_workflow'],
        description:
          'list: 列出站点知识; confirm: 确认草稿; delete: 删除条目; ' +
          'export: 导出知识库; import: 导入知识库; analyze_and_confirm: 分析并一步确认; ' +
          'list_workflows: 列出编排流程; create_workflow: 创建编排流程; delete_workflow: 删除编排流程',
      },
      site: {
        type: 'string',
        description: '站点域名（eTLD+1），list/confirm/analyze_and_confirm 时必填',
      },
      recipe_id: {
        type: 'string',
        description: 'recipe ID，confirm/delete 时必填',
      },
      export_data: {
        type: 'string',
        description: '导入的 JSON 数据（import 时必填）',
      },
      workflow_id: {
        type: 'string',
        description: 'Workflow ID，delete_workflow 时必填',
      },
      workflow: {
        type: 'object',
        description: 'Workflow 定义（create_workflow 时必填），包含 name, site, steps',
      },
    },
    required: ['action'],
  },
  execute: async (args) => {
    const action = args.action as string;

    switch (action) {
      case 'list':
        return handleList(args.site as string | undefined);
      case 'confirm':
        return handleConfirm(args.site as string, args.recipe_id as string | undefined);
      case 'delete':
        return handleDelete(args.recipe_id as string);
      case 'export':
        return handleExport();
      case 'import':
        return handleImport(args.export_data as string);
      case 'analyze_and_confirm':
        return handleAnalyzeAndConfirm(args.site as string);
      case 'list_workflows':
        return handleListWorkflows(args.site as string);
      case 'create_workflow':
        return handleCreateWorkflow(args.workflow as Record<string, unknown> | undefined);
      case 'delete_workflow':
        return handleDeleteWorkflow(args.workflow_id as string);
      default:
        return { error: `未知操作: ${action}` };
    }
  },
};

// ============================================================
// Handlers
// ============================================================

async function handleList(site?: string) {
  if (!site) {
    const sites = await getAllSites();
    if (sites.length === 0) {
      return { message: '知识库为空，尚无任何站点的接口知识', sites: [] };
    }
    const siteInfo = await Promise.all(
      sites.map(async (s) => {
        const recipes = await getRecipesBySite(s);
        return { site: s, recipe_count: recipes.length };
      }),
    );
    return { sites: siteInfo };
  }

  const catalog = await generateApiCatalog(site);
  if (!catalog) {
    return { message: `${site} 尚无接口知识`, site, recipes: [] };
  }
  return { site, catalog };
}

async function handleConfirm(site: string, recipeId?: string) {
  if (!site) {
    return { error: 'confirm 操作需要提供 site 参数' };
  }

  // 从捕获数据分析生成草稿
  const requests = await getCapturedRequests(site);
  if (requests.length === 0) {
    return { error: `${site} 没有捕获数据可供确认` };
  }

  const drafts = analyzeRequests(requests);

  if (recipeId) {
    // 确认单个
    const draft = drafts.find((d) => d.recipe.id === recipeId);
    if (!draft) {
      return { error: `未找到草稿 ${recipeId}`, available: drafts.map((d) => d.recipe.id) };
    }
    const recipe: ApiRecipe = { version: 1, ...draft.recipe };
    await saveRecipe(recipe);
    return { confirmed: recipeId, name: recipe.name };
  }

  // 确认全部
  const saved: string[] = [];
  for (const draft of drafts) {
    const recipe: ApiRecipe = { version: 1, ...draft.recipe };
    await saveRecipe(recipe);
    saved.push(recipe.id);
  }

  // 确认后清除该站点的捕获数据
  await clearCapturedRequests(site);

  return {
    confirmed_count: saved.length,
    recipe_ids: saved,
    message: `已将 ${saved.length} 个接口知识保存到知识库并清除捕获缓存`,
  };
}

async function handleDelete(recipeId: string) {
  if (!recipeId) {
    return { error: 'delete 操作需要提供 recipe_id' };
  }

  const recipe = await getRecipe(recipeId);
  if (!recipe) {
    return { error: `未找到知识条目 ${recipeId}` };
  }

  await deleteRecipe(recipeId);
  return { deleted: recipeId, name: recipe.name };
}

async function handleExport() {
  const data = await exportKnowledgeBase();
  return {
    exported_at: data.exported_at,
    recipe_count: data.recipes.length,
    workflow_count: data.workflows.length,
    sites: Object.keys(data.sites),
    json: JSON.stringify(data, null, 2),
  };
}

async function handleImport(exportData?: string) {
  if (!exportData) {
    return { error: 'import 操作需要提供 export_data（JSON 字符串）' };
  }

  let data: KnowledgeBaseExport;
  try {
    data = JSON.parse(exportData);
  } catch {
    return { error: '导入数据 JSON 解析失败' };
  }

  if (data.version !== 1 || !data.recipes) {
    return { error: '导入数据格式不正确，缺少 version 或 recipes 字段' };
  }

  const count = await importKnowledgeBase(data);
  return {
    imported_count: count,
    message: `成功导入 ${count} 个知识条目`,
  };
}

async function handleAnalyzeAndConfirm(site: string) {
  if (!site) {
    return { error: 'analyze_and_confirm 操作需要提供 site 参数' };
  }

  const requests = await getCapturedRequests(site);
  if (requests.length === 0) {
    return { error: `${site} 没有捕获数据` };
  }

  const drafts = analyzeRequests(requests);
  if (drafts.length === 0) {
    return { error: '分析完成但未生成任何接口草稿', requestCount: requests.length };
  }

  const saved: string[] = [];
  for (const draft of drafts) {
    const recipe: ApiRecipe = { version: 1, ...draft.recipe };
    await saveRecipe(recipe);
    saved.push(recipe.id);
  }

  await clearCapturedRequests(site);

  return {
    site,
    analyzed_requests: requests.length,
    saved_count: saved.length,
    recipes: saved.map((id, i) => ({
      id,
      name: drafts[i].recipe.name,
      description: drafts[i].recipe.description,
      method: drafts[i].recipe.request.method,
      url_template: drafts[i].recipe.request.url_template,
      safe: drafts[i].recipe.safe,
    })),
    message: `分析完成，已将 ${saved.length} 个接口知识保存到知识库`,
  };
}

// ============================================================
// Workflow Handlers
// ============================================================

async function handleListWorkflows(site?: string) {
  if (!site) {
    return { error: 'list_workflows 操作需要提供 site 参数' };
  }

  const workflows = await getWorkflowsBySite(site);
  if (workflows.length === 0) {
    return { message: `${site} 尚无编排流程`, workflows: [] };
  }

  return {
    site,
    workflows: workflows.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      steps_count: w.steps.length,
      steps: w.steps.map((s, i) => ({
        step: i + 1,
        recipe_id: s.recipe_id,
        fixed_params: s.fixed_params,
        bindings: s.bindings,
      })),
    })),
  };
}

async function handleCreateWorkflow(workflowData?: Record<string, unknown>) {
  if (!workflowData) {
    return { error: 'create_workflow 操作需要提供 workflow 参数' };
  }

  const name = workflowData.name as string | undefined;
  const site = workflowData.site as string | undefined;
  const steps = workflowData.steps as Array<{ recipe_id: string; fixed_params?: Record<string, string>; bindings?: Record<string, string> }> | undefined;

  if (!name || !site || !steps?.length) {
    return { error: 'workflow 必须包含 name, site 和至少一个 step' };
  }

  // 验证 recipe 存在
  for (const step of steps) {
    const recipe = await getRecipe(step.recipe_id);
    if (!recipe) {
      return { error: `步骤引用了不存在的 recipe: ${step.recipe_id}` };
    }
  }

  const workflowId = `wf_${site}_${Date.now()}`;
  const workflow: ApiWorkflow = {
    version: 1,
    id: workflowId,
    site,
    name,
    description: (workflowData.description as string) ?? '',
    steps: steps.map((s) => ({
      recipe_id: s.recipe_id,
      fixed_params: s.fixed_params ?? {},
      bindings: s.bindings ?? {},
    })),
  };

  await saveWorkflow(workflow);

  return {
    created: workflowId,
    name,
    steps_count: workflow.steps.length,
    message: `已创建编排流程 "${name}"，包含 ${workflow.steps.length} 个步骤`,
  };
}

async function handleDeleteWorkflow(workflowId?: string) {
  if (!workflowId) {
    return { error: 'delete_workflow 操作需要提供 workflow_id 参数' };
  }

  await deleteWorkflow(workflowId);
  return { deleted: workflowId };
}
