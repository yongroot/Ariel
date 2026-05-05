const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "SVG",
  "BR", "HR", "IMG", "INPUT", "TEXTAREA", "SELECT",
]);

const BLOCK_TAGS = new Set([
  "DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TR", "TD", "TH",
  "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "NAV",
  "MAIN", "ASIDE", "UL", "OL", "TABLE", "FORM", "FIELDSET", "DL", "DD", "DT",
  "FIGURE", "FIGCAPTION", "DETAILS", "SUMMARY",
]);

export function isHidden(el: Element): boolean {
  const style = getComputedStyle(el);
  if (style.display === "none") return true;
  if (style.visibility === "hidden") return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el.tagName === "DETAILS" && !(el as HTMLDetailsElement).open) return true;
  return false;
}

export function extractVisibleText(el: Element): string {
  if (isHidden(el)) return "";
  if (SKIP_TAGS.has(el.tagName)) return "";
  if (el.children.length === 0) {
    return el.textContent?.trim() ?? "";
  }
  const parts: string[] = [];
  for (const child of el.children) {
    const t = extractVisibleText(child);
    if (t) parts.push(t);
  }
  return parts.join(BLOCK_TAGS.has(el.tagName) ? "\n" : " ");
}

export function buildSelector(el: Element): string {
  let sel = el.tagName.toLowerCase();
  if (el.id) return `${sel}#${el.id}`;
  if (el.className && typeof el.className === "string") {
    const classes = el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (classes.length) sel += "." + classes.join(".");
  }
  return sel;
}

export function countInteractive(el: Element): number {
  return el.querySelectorAll("button, a, input, select, textarea, [role='button'], [role='link']").length;
}
