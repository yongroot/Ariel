import type { ToolDefinition } from "../../shared/types";
import { getLatestResponseBody } from "./captured-api";

// ========== 路径解析 ==========

function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    // 支持数组索引: items.0.name
    if (Array.isArray(current)) {
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

// ========== 数据数组定位 ==========

function findDataArray(json: unknown, path?: string): unknown[] {
  if (path) {
    const data = resolvePath(json, path);
    if (Array.isArray(data)) return data;
    throw new Error(`路径 "${path}" 未指向数组，实际类型: ${Array.isArray(data) ? "object" : typeof data}`);
  }
  if (Array.isArray(json)) return json;
  // 自动检测常见结构
  if (typeof json === "object" && json !== null) {
    const obj = json as Record<string, unknown>;
    for (const key of ["data", "items", "rows", "list", "records", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    // 嵌套一层: data.items, data.list, result.data ...
    for (const outer of ["data", "result", "response"]) {
      if (obj[outer] && typeof obj[outer] === "object" && !Array.isArray(obj[outer])) {
        const inner = obj[outer] as Record<string, unknown>;
        for (const innerKey of ["items", "rows", "list", "records", "data"]) {
          if (Array.isArray(inner[innerKey])) return inner[innerKey] as unknown[];
        }
      }
    }
  }
  throw new Error("未在响应中找到数据数组。请通过 path 参数指定 JSON 路径（如 'data.items'、'result.list'）");
}

// ========== 过滤 ==========

interface FilterExpr {
  field: string;
  op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "not_contains";
  value: unknown;
}

function applyFilter(arr: unknown[], filters: FilterExpr[]): unknown[] {
  if (!filters.length) return arr;
  return arr.filter((item) => {
    if (typeof item !== "object" || item === null) return false;
    for (const f of filters) {
      const val = resolvePath(item, f.field);
      switch (f.op) {
        case "eq":
          if (val !== f.value) return false;
          break;
        case "neq":
          if (val === f.value) return false;
          break;
        case "gt":
          if (typeof val !== "number" || typeof f.value !== "number" || !(val > f.value)) return false;
          break;
        case "lt":
          if (typeof val !== "number" || typeof f.value !== "number" || !(val < f.value)) return false;
          break;
        case "gte":
          if (typeof val !== "number" || typeof f.value !== "number" || !(val >= f.value)) return false;
          break;
        case "lte":
          if (typeof val !== "number" || typeof f.value !== "number" || !(val <= f.value)) return false;
          break;
        case "contains":
          if (typeof val !== "string" || !val.includes(String(f.value))) return false;
          break;
        case "not_contains":
          if (typeof val !== "string" || val.includes(String(f.value))) return false;
          break;
      }
    }
    return true;
  });
}

// ========== 聚合操作 ==========

interface Operation {
  type: "count" | "sum" | "avg" | "min" | "max" | "groupby" | "unique" | "top";
  field?: string;
  valueField?: string;
  aggregate?: "count" | "sum" | "avg";
  limit?: number;
}

function numericValues(arr: unknown[], field?: string): number[] {
  return arr
    .map((item) => {
      const v = field ? resolvePath(item, field) : item;
      return typeof v === "number" ? v : null;
    })
    .filter((v): v is number => v !== null);
}

function executeOperation(arr: unknown[], op: Operation): unknown {
  switch (op.type) {
    case "count":
      return arr.length;

    case "sum": {
      const vals = numericValues(arr, op.field);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : 0;
    }

    case "avg": {
      const vals = numericValues(arr, op.field);
      return vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : 0;
    }

    case "min": {
      const vals = numericValues(arr, op.field);
      if (vals.length === 0) return null;
      return Math.min(...vals);
    }

    case "max": {
      const vals = numericValues(arr, op.field);
      if (vals.length === 0) return null;
      return Math.max(...vals);
    }

    case "groupby": {
      const groupField = op.field || "";
      const aggType = op.aggregate || "count";
      const valField = op.valueField;

      const groups: Record<string, { count: number; sum: number; numValues: number }> = {};

      for (const item of arr) {
        const key = String(resolvePath(item, groupField) ?? "(空)");
        if (!groups[key]) groups[key] = { count: 0, sum: 0, numValues: 0 };
        groups[key].count++;

        if (valField && aggType !== "count") {
          const v = resolvePath(item, valField);
          if (typeof v === "number") {
            groups[key].sum += v;
            groups[key].numValues++;
          }
        }
      }

      const result: Record<string, number> = {};
      for (const [key, g] of Object.entries(groups)) {
        switch (aggType) {
          case "count":
            result[key] = g.count;
            break;
          case "sum":
            result[key] = g.sum;
            break;
          case "avg":
            result[key] = g.numValues > 0 ? Math.round((g.sum / g.numValues) * 100) / 100 : 0;
            break;
        }
      }

      return result;
    }

    case "unique": {
      const vals = arr.map((item) => resolvePath(item, op.field || ""));
      const uniqueSet = new Set(vals.map((v) => (v === null || v === undefined ? "(空)" : String(v))));
      return {
        count: uniqueSet.size,
        values: [...uniqueSet],
      };
    }

    case "top": {
      const field = op.field || "";
      const limit = op.limit || 10;
      const sorted = [...arr].sort((a, b) => {
        const va = resolvePath(a, field);
        const vb = resolvePath(b, field);
        if (typeof va === "number" && typeof vb === "number") return vb - va;
        return String(va ?? "").localeCompare(String(vb ?? ""), "zh-CN");
      });
      return sorted.slice(0, limit);
    }

    default:
      return null;
  }
}

// ========== 工具定义 ==========

export const analyzeDataTool: ToolDefinition = {
  name: "analyze_data",
  description:
    "对捕获的 API 响应数据进行聚合分析。当需要对列表/表格数据进行统计时使用。" +
    "支持的操作：count(计数)、sum(求和)、avg(均值)、min(最小)、max(最大)、" +
    "groupby(分组统计)、unique(去重)、top(排序取前N)。" +
    "可先通过 filter 过滤数据，再执行多个聚合操作。" +
    "注意：此工具使用完整响应体数据，不受截断限制。",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL 关键词，定位要分析的捕获请求（自动取最近匹配的）",
      },
      path: {
        type: "string",
        description: "JSON 数据路径，指向要分析的数组。如 'data.items'、'result.list'、'rows'。不传则自动检测。",
      },
      filters: {
        type: "array",
        description: "过滤条件（在聚合前应用），每个条件: { field, op, value }。op 支持: eq(等于)、neq(不等于)、gt(大于)、lt(小于)、gte(大于等于)、lte(小于等于)、contains(包含)、not_contains(不包含)",
        items: {
          type: "object",
          properties: {
            field: { type: "string", description: "字段路径，如 'status'、'amount'" },
            op: { type: "string", enum: ["eq", "neq", "gt", "lt", "gte", "lte", "contains", "not_contains"] },
            value: { description: "比较值，数字或字符串" },
          },
          required: ["field", "op", "value"],
        },
      },
      operations: {
        type: "array",
        description: "要执行的聚合操作列表",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["count", "sum", "avg", "min", "max", "groupby", "unique", "top"],
              description: "操作类型",
            },
            field: { type: "string", description: "操作字段（count 不需要）" },
            valueField: { type: "string", description: "groupby 时，聚合的数值字段（配合 aggregate 使用）" },
            aggregate: { type: "string", enum: ["count", "sum", "avg"], description: "groupby 时的聚合方式，默认 count" },
            limit: { type: "number", description: "top 操作时的返回数量，默认 10" },
          },
          required: ["type"],
        },
      },
    },
    required: ["url", "operations"],
  },
  execute: async (args) => {
    const urlKeyword = args.url as string;

    // 1. 获取完整响应体
    const captured = getLatestResponseBody(urlKeyword);
    if (!captured) {
      return { error: `没有找到匹配 "${urlKeyword}" 的已捕获请求`, hint: "请先确保页面已加载相关 API 请求" };
    }

    // 2. 解析 JSON
    let json: unknown;
    try {
      json = JSON.parse(captured.responseBody!);
    } catch {
      return { error: "响应体 JSON 解析失败", url: captured.url };
    }

    // 3. 定位数据数组
    const path = args.path as string | undefined;
    let dataArr: unknown[];
    try {
      dataArr = findDataArray(json, path);
    } catch (err) {
      return { error: (err as Error).message, url: captured.url, hint: "尝试用 path 参数指定数组路径" };
    }

    // 4. 应用过滤
    const filters = (args.filters as FilterExpr[]) || [];
    let filtered = applyFilter(dataArr, filters);

    // 5. 执行聚合操作
    const operations = (args.operations as Operation[]) || [];
    if (operations.length === 0) {
      return { error: "请至少指定一个 operation", url: captured.url, dataCount: filtered.length };
    }

    const results: Record<string, unknown> = {
      sourceUrl: captured.url,
      totalRecords: dataArr.length,
      filteredRecords: filtered.length,
      filters: filters.length > 0 ? filters : undefined,
    };

    for (const op of operations) {
      const label = op.field ? `${op.type}(${op.field})` : op.type;
      results[label] = executeOperation(filtered, op);
    }

    return results;
  },
};
