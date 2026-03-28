import { NextResponse } from "next/server";
import { createAiHtmlReadableStream, generateAiHtml } from "@/lib/ai-html";
import type { RenderEvent } from "@/lib/ai-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBody(data: unknown): RenderEvent {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid body");
  }
  const o = data as Record<string, unknown>;
  const type = o.type;

  if (type === "initial") {
    return { type: "initial" };
  }

  if (type === "navigate") {
    const interaction = o.interaction;
    if (!interaction || typeof interaction !== "object") {
      throw new Error("Missing interaction");
    }
    const i = interaction as Record<string, unknown>;
    if (i.kind === "link") {
      return {
        type: "navigate",
        interaction: {
          kind: "link",
          href: String(i.href ?? ""),
          text: String(i.text ?? ""),
        },
      };
    }
    if (i.kind === "button") {
      return {
        type: "navigate",
        interaction: {
          kind: "button",
          label: String(i.label ?? ""),
          name: i.name != null ? String(i.name) : undefined,
          value: i.value != null ? String(i.value) : undefined,
        },
      };
    }
    throw new Error("Invalid interaction kind");
  }

  throw new Error("Unknown event type");
}

export async function POST(req: Request) {
  try {
    const json: unknown = await req.json();
    const o = json as Record<string, unknown>;
    const wantsStream = o.stream === true;
    const event = parseBody(json);

    if (wantsStream) {
      return new Response(createAiHtmlReadableStream(event), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const html = await generateAiHtml(event);
    return NextResponse.json({ html });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Render failed";
    const status = message === "OPENAI_API_KEY is not set" ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
