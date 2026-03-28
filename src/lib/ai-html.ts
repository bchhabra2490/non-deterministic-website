import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { RenderEvent } from "./ai-events";
import { extractHtml, sanitizeAiHtml } from "./html-postprocess";

const DEFAULT_MODEL = "gpt-4o-mini";

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return new OpenAI({ apiKey: key });
}

function modelOptions() {
  const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const temperature = Number.parseFloat(process.env.OPENAI_TEMPERATURE ?? "0.85");
  const maxRaw = process.env.OPENAI_MAX_OUTPUT_TOKENS;
  const max_completion_tokens =
    maxRaw != null && maxRaw !== ""
      ? Number.parseInt(maxRaw, 10)
      : undefined;
  return {
    model,
    temperature: Number.isFinite(temperature) ? temperature : 0.85,
    ...(Number.isFinite(max_completion_tokens) && max_completion_tokens! > 0
      ? { max_completion_tokens: max_completion_tokens! }
      : {}),
  };
}

function systemPrompt(): string {
  return [
    "You generate semantic HTML fragments for a single-page experience that is hydrated in the browser.",
    "Output ONLY valid HTML. Do not wrap in markdown code fences unless you have no other choice.",
    "No <html>, <head>, or <body> tags. Use elements like <main>, <article>, <section>, <nav>, <header>, <footer>, <p>, <ul>, etc.",
    "Styling MUST use Tailwind CSS utility classes on (almost) every element: layout (flex/grid, gap, max-w-*, mx-auto, px/py), typography (text-*, font-*, leading-*), color (bg-*, text-*, border-*), and responsive prefixes (sm:, md:, lg:) where helpful.",
    "Contrast is mandatory. Never put text and background in the same Tailwind color family AND the same (or adjacent) shade—e.g. never text-zinc-600 on bg-zinc-600, text-violet-500 on bg-violet-500, text-blue-200 on bg-blue-200. That includes inherited text sitting on a parent with matching bg-*.",
    "Light backgrounds (white, zinc-50–200, slate-50–200, etc.) need dark text (typically text-zinc-900, text-zinc-800, text-slate-900, or darker text-* on colored light panels). Dark backgrounds (zinc-800–950, violet-800–950, etc.) need light text (text-white, text-zinc-50, text-zinc-100).",
    "Do not use near-invisible pairs: pale text on pale bg, or muted text on the same muted bg. When unsure, default to bg-white + text-zinc-900 or bg-zinc-900 + text-zinc-50.",
    "Prefer prose prose-zinc max-w-none for long copy on light backgrounds. Do not use prose-invert or dark:prose-invert unless the surrounding section has a dark background.",
    "Stick to standard Tailwind scales (e.g. spacing 4/6/8/12, rounded-xl, shadow-sm). Avoid arbitrary values like w-[413px] unless necessary.",
    "Use a cohesive, modern editorial style with clear hierarchy and scannable sections.",
    "Include interactive elements: use <a href=\"#/path\"> or <a href=\"/concept\"> for in-app navigation (they are intercepted).",
    "Use <button type=\"button\"> for actions; labels should be descriptive.",
    "Do not include <script>, on* event attributes, or iframes.",
  ].join(" ");
}

function userMessage(event: RenderEvent): string {
  switch (event.type) {
    case "initial":
      return [
        "Event: INITIAL_LOAD.",
        "Keep the page SMALL: one lightweight screen, fast to scan. Do not build a long marketing site.",
        "Site name in nav/hero: \"Non-Deterministic Site\" (playful, honest about variability).",
        "Structure (all Tailwind-styled, minimal):",
        "1) Compact top bar: brand + 2–4 in-app links + one primary <button type=\"button\"> or link CTA.",
        "2) Hero: one headline, one short paragraph (2–3 sentences max), one secondary link or button.",
        "3) One small block only: either a 2–3 item bullet list OR two tiny feature blurbs (title + one line each)—not both.",
        "4) Optional single <details>/<summary> FAQ item OR omit if it adds bulk.",
        "5) Tiny footer line with 1–2 links.",
        "Cap total visible copy at about 120–220 words. No testimonials grid, pricing tables, logo walls, or multi-section long scroll.",
        "Every element must keep foreground text clearly separated from its background (no same-shade text/bg in Tailwind).",
      ].join("\n");
    case "navigate":
      if (event.interaction.kind === "link") {
        return [
          "Event: NAVIGATE_LINK.",
          `href: ${event.interaction.href}`,
          `link text: ${event.interaction.text}`,
          "Replace the view with a full new page-like HTML fragment appropriate for that destination.",
          "Style entirely with Tailwind CSS utilities (and prose where appropriate).",
          "Keep site identity consistent (\"Non-Deterministic Site\" where a brand fits), ensure text and background are never the same Tailwind color shade, and include back-relevant links or a clear way to explore further.",
        ].join("\n");
      }
      return [
        "Event: NAVIGATE_BUTTON.",
        `button label: ${event.interaction.label}`,
        event.interaction.name ? `name: ${event.interaction.name}` : "",
        event.interaction.value != null ? `value: ${event.interaction.value}` : "",
        "Render a new HTML fragment that represents the outcome of this action, fully styled with Tailwind utilities; never use matching text-* and bg-* shades on the same surface.",
      ]
        .filter(Boolean)
        .join("\n");
  }
}

export function renderMessages(event: RenderEvent): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: systemPrompt() },
    { role: "user", content: userMessage(event) },
  ];
}

/** Streams raw model text (UTF-8). Caller should run {@link finalizeAiMarkup} on the full buffer if used client-side. */
export function createAiHtmlReadableStream(event: RenderEvent): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        const openai = getClient();
        const stream = await openai.chat.completions.create({
          ...modelOptions(),
          messages: renderMessages(event),
          stream: true,
        });
        for await (const part of stream) {
          const content = part.choices[0]?.delta?.content ?? "";
          if (content) controller.enqueue(encoder.encode(content));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

export async function generateAiHtml(event: RenderEvent): Promise<string> {
  const openai = getClient();
  const completion = await openai.chat.completions.create({
    ...modelOptions(),
    messages: renderMessages(event),
    stream: false,
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error("Empty model response");
  }

  return sanitizeAiHtml(extractHtml(raw));
}
