"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NavigateInteraction } from "@/lib/ai-events";

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

async function postRender(
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<string> {
  const res = await fetch("/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const data = (await res.json()) as { html?: string; error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  const html = data.html?.trim() ?? "";
  if (!html) {
    throw new Error("No HTML in response");
  }
  return html;
}

export function AiSiteClient() {
  const flightRef = useRef<AbortController | null>(null);
  const shellKeyRef = useRef(0);

  const [shellKey, setShellKey] = useState(0);
  const [liveHtml, setLiveHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingNav, setLoadingNav] = useState(false);

  const beginFlight = useCallback(() => {
    flightRef.current?.abort();
    shellKeyRef.current += 1;
    setShellKey(shellKeyRef.current);
    setLiveHtml("");
    const ac = new AbortController();
    flightRef.current = ac;
    return ac;
  }, []);

  const loadInitial = useCallback(async () => {
    const ac = beginFlight();
    setError(null);
    setLoadingNav(true);
    try {
      const html = await postRender({ type: "initial" }, ac.signal);
      setLiveHtml(html);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoadingNav(false);
    }
  }, [beginFlight]);

  const navigateWith = useCallback(
    async (interaction: NavigateInteraction) => {
      const ac = beginFlight();
      setError(null);
      setLoadingNav(true);
      try {
        const html = await postRender(
          { type: "navigate", interaction },
          ac.signal
        );
        setLiveHtml(html);
        window.scrollTo(0, 0);
      } catch (e) {
        if (isAbortError(e)) return;
        setError(e instanceof Error ? e.message : "Navigation failed");
      } finally {
        setLoadingNav(false);
      }
    },
    [beginFlight]
  );

  useEffect(() => {
    const ac = beginFlight();
    let cancelled = false;

    setError(null);
    setLoadingNav(true);

    void (async () => {
      try {
        const html = await postRender({ type: "initial" }, ac.signal);
        if (cancelled || ac.signal.aborted) return;
        setLiveHtml(html);
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
    };
  }, [beginFlight]);

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
