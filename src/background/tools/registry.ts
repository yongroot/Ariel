import type { ToolDefinition } from "../../shared/types";
import { inspectTool, readTool } from "./page-tools";
import { capturedApiTool, handleCapturedRequest, getCapturedCount, getCapturedList, clearCaptured } from "./captured-api";
import { analyzeDataTool } from "./analyze-data";
import { analyzeApisTool, manageKnowledgeTool } from "./api-knowledge-tools";
import { invokeApiTool } from "./invoke-api";
import { executeWorkflowTool } from "./workflow-executor";

const tools: ToolDefinition[] = [inspectTool, readTool, capturedApiTool, analyzeDataTool, analyzeApisTool, manageKnowledgeTool, invokeApiTool, executeWorkflowTool];

export function getToolDefinitions() {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`未知工具: ${name}`);
  return tool.execute(args);
}

// Content Script 推送捕获的 API 请求
export { handleCapturedRequest, getCapturedCount, getCapturedList, clearCaptured };
