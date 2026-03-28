import DOMPurify from "isomorphic-dompurify";

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
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|tel|#|\/|\.{0,2}\/)[^\s]*|[^:\s]*#[^\s]*)$/i,
  });
}

export function finalizeAiMarkup(raw: string): string {
  return sanitizeAiHtml(extractHtml(raw));
}
