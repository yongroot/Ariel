/**
 * Workflow 执行器 — 线性步骤编排
 *
 * $N.path 语法从第 N 步响应取值，任一 step 失败则整体中止。
 */

import type { ToolDefinition } from '../../shared/types';
import type { WorkflowStep } from '../../shared/api-knowledge-types';
import { getWorkflow } from '../api-knowledge-store';
import { invokeApiTool } from './invoke-api';

// ============================================================
// 路径解析（复用 invoke-api 的 extractByPath 逻辑）
// ============================================================

/** 从对象中按 dot.notation[0] 路径取值 */
function extractByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    // 支持 key[index] 或 key.index 两种写法
    const bracketMatch = key.match(/^(\w+)\[(\d+)\]$/);
    if (bracketMatch) {
      const [, objKey, idxStr] = bracketMatch;
      current = (current as Record<string, unknown>)[objKey];
      if (!Array.isArray(current)) return undefined;
      const idx = parseInt(idxStr, 10);
      current = current[idx];
    } else if (Array.isArray(current)) {
      const idx = parseInt(key, 10);
      if (!isNaN(idx) && idx >= 0 && idx < current.length) {
        current = current[idx];
      } else {
        return undefined;
      }
    } else {
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

// ============================================================
// 绑定表达式解析
// ============================================================

/** 解析 "$N.data.path" 表达式，返回实际值 */
function resolveBinding(
  expression: string,
  stepResults: unknown[],
): { value: unknown; error?: string } {
  const match = expression.match(/^\$(\d+)(?:\.(.+))?$/);
  if (!match) {
    return { value: undefined, error: `无效的绑定表达式: ${expression}` };
  }

  const stepIndex = parseInt(match[1], 10);
  if (stepIndex >= stepResults.length) {
    return { value: undefined, error: `引用了不存在的步骤 ${stepIndex}（已完成 ${stepResults.length} 步）` };
  }

  const path = match[2] ?? '';
  const value = extractByPath(stepResults[stepIndex], path);

  if (value === undefined && path) {
    return { value: undefined, error: `步骤 ${stepIndex} 的响应中不存在路径: ${path}` };
  }

  return { value };
}

/** 合并 fixed_params + 解析后的 bindings */
function resolveStepParams(
  step: WorkflowStep,
  stepResults: unknown[],
): { params: Record<string, string>; error?: string } {
  const params: Record<string, string> = { ...step.fixed_params };

  for (const [key, expression] of Object.entries(step.bindings)) {
    const { value, error } = resolveBinding(expression, stepResults);
    if (error) {
      return { params: {}, error: `参数 "${key}" 解析失败: ${error}` };
    }
    params[key] = String(value);
  }

  return { params };
}

// ============================================================
// Workflow 执行器
// ============================================================

export interface WorkflowResult {
  success: boolean;
  results: unknown[];
  error?: string;
  failedStep?: number;
}

export async function executeWorkflow(workflowId: string): Promise<WorkflowResult> {
  const workflow = await getWorkflow(workflowId);
  if (!workflow) {
    return { success: false, results: [], error: `未找到 Workflow: ${workflowId}` };
  }

  if (workflow.steps.length === 0) {
    return { success: false, results: [], error: 'Workflow 没有步骤' };
  }

  const stepResults: unknown[] = [];

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];

    // 解析参数
    const { params, error: resolveError } = resolveStepParams(step, stepResults);
    if (resolveError) {
      return {
        success: false,
        results: stepResults,
        error: `步骤 ${i + 1} (${step.recipe_id}) 参数解析失败: ${resolveError}`,
        failedStep: i,
      };
    }

    // 调用 invoke_api（workflow 内自动确认写操作）
    const result = await invokeApiTool.execute({
      recipe_id: step.recipe_id,
      params,
      confirmed: true,
    }) as { success?: boolean; data?: unknown; error?: string; status?: number };

    if (!result.success) {
      return {
        success: false,
        results: stepResults,
        error: `步骤 ${i + 1} (${step.recipe_id}) 执行失败: ${result.error ?? '未知错误'}`,
        failedStep: i,
      };
    }

    stepResults.push(result.data);
  }

  return { success: true, results: stepResults };
}

// ============================================================
// Tool Definition
// ============================================================

export const executeWorkflowTool: ToolDefinition = {
  name: 'execute_workflow',
  description:
    '执行一个已定义的接口编排流程（多个接口按顺序调用）。' +
    '步骤间可通过 $N.path 语法引用前序步骤的返回值。' +
    '任一步骤失败则整体中止。',
  parameters: {
    type: 'object',
    properties: {
      workflow_id: {
        type: 'string',
        description: '要执行的 Workflow ID',
      },
    },
    required: ['workflow_id'],
  },
  execute: async (args) => {
    const workflowId = args.workflow_id as string;
    return executeWorkflow(workflowId);
  },
};
