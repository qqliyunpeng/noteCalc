/** Text measurement for the result column, mirroring Qt's font metrics. */

export const EDITOR_FONT_STACK = 'Consolas, "Cascadia Mono", ui-monospace, monospace';
export const TAB_COLUMNS = 4;

let context: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

function context2d(): CanvasRenderingContext2D | null {
  if (context) return context;
  if (typeof document === "undefined") return null;
  context = document.createElement("canvas").getContext("2d");
  return context;
}

export function fontString(fontSize: number): string {
  return `${fontSize}px ${EDITOR_FONT_STACK}`;
}

export function measure(text: string, font: string): number {
  const key = `${font}\u0000${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  const ctx = context2d();
  const width = ctx ? (ctx.font = font, ctx.measureText(text).width) : text.length * 8;
  if (widthCache.size > 4000) widthCache.clear();
  widthCache.set(key, width);
  return width;
}

/** Width of one tab stop, i.e. four space advances, like the Qt editor. */
export function tabStopWidth(font: string): number {
  return measure(" ", font) * TAB_COLUMNS;
}

/** Port of the Qt editor's `_line_width`, including tab-stop expansion. */
export function lineWidth(text: string, font: string, tabStop: number): number {
  if (tabStop <= 0 || !text.includes("\t")) return measure(text, font);
  let width = 0;
  const parts = text.split("\t");
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) width = (Math.floor(width / tabStop) + 1) * tabStop;
    width += measure(parts[index], font);
  }
  return width;
}