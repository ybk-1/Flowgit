/** The board's i18n module (packages/web/public/i18n.js), loaded by the page. */
export interface I18nApi {
  raw(node: Element, source: string): Element;
  pick(text: string): string;
  lang(): "zh" | "en";
  onChange(listener: (lang: string) => void): void;
}

/** An element with bilingual text ("中文 / English"); the board's I18N keeps the current language's half. */
export function el<K extends keyof HTMLElementTagNameMap>(
  i18n: I18nApi,
  tag: K,
  text?: string,
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text !== undefined) i18n.raw(node, text);
  return node;
}
