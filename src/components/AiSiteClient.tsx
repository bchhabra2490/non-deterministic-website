"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NavigateInteraction } from "@/lib/ai-events";
import { finalizeAiMarkup, sanitizeAiHtml } from "@/lib/html-postprocess";

/** Same-origin History API update: address bar follows the link without a document navigation. */
function pushUrlFromLinkHref(href: string): void {
  if (!href || href.startsWith("javascript:")) return;
  try {
    const resolved = new URL(href, window.location.href);
    if (resolved.origin !== window.location.origin) return;
    const next =
      resolved.pathname + (resolved.search || "") + (resolved.hash || "");
    const cur =
      window.location.pathname +
      window.location.search +
      window.location.hash;
    if (next === cur) return;
    window.history.pushState({ nds: true }, "", next);
  } catch {
    /* ignore malformed href */
  }
}

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

function cancelRaf(rafRef: { current: number | null }) {
  if (rafRef.current != null) {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }
}

async function postRenderStream(
  body: Record<string, unknown>,
  signal: AbortSignal,
  onRawDelta: (cumulativeRaw: string) => void
): Promise<string> {
  const res = await fetch("/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  const ct = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    if (ct.includes("application/json")) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? `Request failed (${res.status})`);
    }
    const text = await res.text();
    throw new Error(text || `Request failed (${res.status})`);
  }

  if (!res.body) {
    throw new Error("Empty response body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    onRawDelta(raw);
  }

  const html = finalizeAiMarkup(raw);
  if (!html.trim()) {
    throw new Error("Empty model response");
  }
  return html;
}

export function AiSiteClient() {
  const flightRef = useRef<AbortController | null>(null);
  const shellKeyRef = useRef(0);
  const previewRafRef = useRef<number | null>(null);
  const pendingRawRef = useRef("");

  const [shellKey, setShellKey] = useState(0);
  const [liveHtml, setLiveHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingNav, setLoadingNav] = useState(false);

  const queueStreamingPreview = useCallback((raw: string) => {
    const generation = shellKeyRef.current;
    pendingRawRef.current = raw;
    if (previewRafRef.current != null) return;
    previewRafRef.current = requestAnimationFrame(() => {
      previewRafRef.current = null;
      if (shellKeyRef.current !== generation) return;
      setLiveHtml(sanitizeAiHtml(pendingRawRef.current));
    });
  }, []);

  const beginFlight = useCallback(() => {
    flightRef.current?.abort();
    cancelRaf(previewRafRef);
    shellKeyRef.current += 1;
    setShellKey(shellKeyRef.current);
    setLiveHtml("");
    const ac = new AbortController();
    flightRef.current = ac;
    return ac;
  }, []);

  const finishStreamToDom = useCallback((finalHtml: string) => {
    cancelRaf(previewRafRef);
    setLiveHtml(finalHtml);
  }, []);

  const loadInitial = useCallback(async () => {
    const ac = beginFlight();
    setError(null);
    setLoadingNav(true);
    try {
      const html = await postRenderStream(
        { type: "initial" },
        ac.signal,
        queueStreamingPreview
      );
      finishStreamToDom(html);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoadingNav(false);
    }
  }, [beginFlight, finishStreamToDom, queueStreamingPreview]);

  const navigateWith = useCallback(
    async (interaction: NavigateInteraction) => {
      const ac = beginFlight();
      setError(null);
      setLoadingNav(true);
      try {
        const html = await postRenderStream(
          { type: "navigate", interaction },
          ac.signal,
          queueStreamingPreview
        );
        finishStreamToDom(html);
        window.scrollTo(0, 0);
      } catch (e) {
        if (isAbortError(e)) return;
        setError(e instanceof Error ? e.message : "Navigation failed");
      } finally {
        setLoadingNav(false);
      }
    },
    [beginFlight, finishStreamToDom, queueStreamingPreview]
  );

  useEffect(() => {
    const ac = beginFlight();
    let cancelled = false;

    setError(null);
    setLoadingNav(true);

    void (async () => {
      try {
        const html = await postRenderStream(
          { type: "initial" },
          ac.signal,
          queueStreamingPreview
        );
        if (cancelled || ac.signal.aborted) return;
        finishStreamToDom(html);
      } catch (e) {
        if (isAbortError(e) || cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoadingNav(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
      cancelRaf(previewRafRef);
    };
  }, [beginFlight, finishStreamToDom, queueStreamingPreview]);

  function onInteractClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const anchor = target.closest("a[href]");
    if (anchor instanceof HTMLAnchorElement) {
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("javascript:")) return;
      if (anchor.target === "_blank") return;
      e.preventDefault();
      pushUrlFromLinkHref(href);
      void navigateWith({
        kind: "link",
        href,
        text: anchor.textContent?.trim() ?? "",
      });
      return;
    }

    const roleControl = target.closest('[role="button"]');
    if (
      roleControl instanceof HTMLElement &&
      !(roleControl instanceof HTMLButtonElement)
    ) {
      e.preventDefault();
      void navigateWith({
        kind: "button",
        label: roleControl.textContent?.trim() || "Control",
      });
      return;
    }

    const btn = target.closest("button");
    if (btn instanceof HTMLButtonElement) {
      if (btn.type === "submit" && btn.closest("form")) return;
      e.preventDefault();
      void navigateWith({
        kind: "button",
        label: btn.textContent?.trim() || btn.value || "Button",
        name: btn.name || undefined,
        value: btn.value || undefined,
      });
    }
  }

  return (
    <div
      className="relative min-h-full flex-1 flex flex-col"
      aria-busy={loadingNav}
    >
      <span className="sr-only" aria-live="polite">
        {loadingNav ? "Loading" : ""}
      </span>

      {loadingNav ? (
        <div
          className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center"
          aria-hidden
        >
          <div
            className="h-9 w-9 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-700"
            role="presentation"
          />
        </div>
      ) : null}

      {error ? (
        <div className="sr-only" role="alert">
          {error}
          <button
            type="button"
            aria-label="Retry"
            onClick={() => void loadInitial()}
          />
        </div>
      ) : null}

      <div
        key={shellKey}
        onClick={onInteractClick}
        dangerouslySetInnerHTML={{ __html: liveHtml }}
      />
    </div>
  );
}
