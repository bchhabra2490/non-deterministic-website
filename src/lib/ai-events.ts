export type RenderEvent =
  | { type: "initial" }
  | {
      type: "navigate";
      interaction: NavigateInteraction;
    };

export type NavigateInteraction =
  | { kind: "link"; href: string; text: string }
  | { kind: "button"; label: string; name?: string; value?: string };
