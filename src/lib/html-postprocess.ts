import sanitizeHtml from "sanitize-html";

/** Pure-JS sanitizer (no JSDOM) — reliable on Vercel serverless vs isomorphic-dompurify. */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a",
    "abbr",
    "article",
    "aside",
    "b",
    "blockquote",
    "br",
    "button",
    "caption",
    "cite",
    "code",
    "dd",
    "details",
    "div",
    "dl",
    "dt",
    "em",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "i",
    "img",
    "label",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "small",
    "span",
    "strong",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  allowedAttributes: {
    "*": ["class", "id"],
    a: ["href", "target", "rel", "class", "id"],
    img: ["src", "alt", "width", "height", "class", "id", "loading", "decoding"],
    button: ["type", "name", "value", "class", "id"],
    th: ["colspan", "rowspan", "scope", "class", "id"],
    td: ["colspan", "rowspan", "class", "id"],
    ol: ["start", "class", "id", "type"],
    time: ["datetime", "class", "id"],
  },
  allowProtocolRelative: false,
  allowedSchemesByTag: {
    img: ["http", "https"],
    a: ["http", "https", "mailto", "tel"],
  },
};

export function extractHtml(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) return fenced[1].trim();
  if (trimmed.startsWith("```")) {
    const inner = trimmed.replace(/^```(?:html)?\s*\n?/i, "").replace(/\n```\s*$/i, "");
    return inner.trim();
  }
  return trimmed;
}

export function sanitizeAiHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

export function finalizeAiMarkup(raw: string): string {
  return sanitizeAiHtml(extractHtml(raw));
}
