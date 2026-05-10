import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  CanvasRenderer,
]);

interface SimpleConfig {
  type: "bar" | "line" | "pie" | "scatter";
  title?: string;
  xAxis?: string[];
  series?: Array<{ name?: string; data: number[] | Array<{ name: string; value: number }> }>;
  height?: number;
}

interface NativeConfig {
  option: Record<string, unknown>;
  height?: number;
}

type ChartConfig = SimpleConfig | NativeConfig;

function isNativeConfig(cfg: ChartConfig): cfg is NativeConfig {
  return "option" in cfg;
}

/** Read a CSS variable's current value */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Build a color palette from theme accent */
function themePalette(): string[] {
  const accent = cssVar("--ap-accent") || "#3b82f6";
  const base: string[] = [
    accent,
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#84cc16",
  ];
  return base;
}

/** Convert simple config → ECharts option */
function toEchartsOption(cfg: SimpleConfig): Record<string, unknown> {
  const textColor = cssVar("--ap-text-primary") || "#18181b";
  const mutedColor = cssVar("--ap-text-muted") || "#a1a1aa";
  const borderColor = cssVar("--ap-border") || "#e4e4e7";
  const palette = themePalette();

  const base: Record<string, unknown> = {
    color: palette,
    textStyle: { color: textColor, fontFamily: "system-ui, sans-serif" },
    title: cfg.title
      ? { text: cfg.title, textStyle: { color: textColor, fontSize: 14 }, left: "center" }
      : undefined,
    tooltip: { trigger: cfg.type === "pie" ? "item" : "axis" },
    grid: { left: "12%", right: "8%", bottom: "15%", top: cfg.title ? "18%" : "10%", containLabel: false },
  };

  if (cfg.type === "pie") {
    const seriesData = cfg.series?.[0]?.data;
    const data = Array.isArray(seriesData)
      ? seriesData.map((item, i) =>
          typeof item === "object" && "name" in item
            ? item
            : { name: `${i + 1}`, value: item as number }
        )
      : [];
    return {
      ...base,
      series: [
        {
          type: "pie",
          radius: ["0%", "65%"],
          center: ["50%", "55%"],
          data,
          label: { color: textColor },
        },
      ],
    };
  }

  return {
    ...base,
    xAxis: {
      type: "category",
      data: cfg.xAxis || [],
      axisLine: { lineStyle: { color: borderColor } },
      axisLabel: { color: mutedColor, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      splitLine: { lineStyle: { color: borderColor, opacity: 0.3 } },
      axisLabel: { color: mutedColor, fontSize: 11 },
    },
    series:
      cfg.series?.map((s) => ({
        type: cfg.type,
        name: s.name,
        data: s.data as number[],
      })) || [],
  };
}

/** Initialize an ECharts instance on a container element */
export function initChart(container: HTMLElement, rawConfig: unknown, animate = true): echarts.ECharts | null {
  let cfg: ChartConfig;
  try {
    cfg = typeof rawConfig === "string" ? JSON.parse(rawConfig) : (rawConfig as ChartConfig);
  } catch {
    container.textContent = "图表配置解析失败";
    return null;
  }

  const height = cfg.height || 280;
  container.style.height = `${height}px`;
  container.style.width = "100%";

  const option = isNativeConfig(cfg) ? cfg.option : toEchartsOption(cfg as SimpleConfig);

  const chart = echarts.init(container);
  chart.setOption({ ...option, animation: animate });
  return chart;
}

/** Scan a parent element for `.chart-placeholder` divs and mount charts */
export function mountCharts(parent: HTMLElement, cache: Map<string, echarts.ECharts>): () => void {
  const placeholders = parent.querySelectorAll<HTMLDivElement>(".chart-placeholder:not([data-chart-initialized])");
  const charts: echarts.ECharts[] = [];
  const observers: ResizeObserver[] = [];

  placeholders.forEach((el) => {
    const configKey = el.getAttribute("data-chart-config");
    if (!configKey) return;
    try {
      const config = JSON.parse(decodeURIComponent(configKey));
      const isRerender = cache.has(configKey);
      const chart = initChart(el, config, !isRerender);
      if (chart) {
        cache.set(configKey, chart);
        el.setAttribute("data-chart-initialized", "1");
        charts.push(chart);
        const ro = new ResizeObserver(() => chart.resize());
        ro.observe(el);
        observers.push(ro);
      }
    } catch {
      el.textContent = "图表渲染失败";
    }
  });

  return () => {
    charts.forEach((c) => c.dispose());
    observers.forEach((o) => o.disconnect());
  };
}
