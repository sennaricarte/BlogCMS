import { Node, mergeAttributes } from "@tiptap/core";

const VIMEO_PLAYER = /player\.vimeo\.com\/video\/(\d+)/i;

/** ID numérico a partir de URL de página, canal, grupo ou player embed. */
export function getVimeoId(url: string): string | null {
  const t = url.trim();
  const player = t.match(VIMEO_PLAYER);
  if (player) {
    return player[1];
  }
  // vimeo.com/123, /channels/…/123, /groups/…/videos/123, etc. (último segmento numérico)
  const noQuery = t.split("?")[0] || t;
  const lastSeg = noQuery.match(/\/(\d+)(?:\/)?$/);
  if (lastSeg) {
    return lastSeg[1];
  }
  return null;
}

export function isValidVimeoUrl(url: string): boolean {
  return getVimeoId(url) !== null;
}

function embedSrcFromInput(url: string): string | null {
  const id = getVimeoId(url);
  if (!id) return null;
  return `https://player.vimeo.com/video/${id}`;
}

type VimeoOptions = {
  allowFullscreen: boolean;
  width: number;
  height: number;
  HTMLAttributes: Record<string, unknown>;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    vimeo: {
      setVimeoVideo: (o: { src: string; width?: number; height?: number }) => ReturnType;
    };
  }
}

/**
 * Nó de incorporação Vimeo (iframe player), espelhando o padrão do @tiptap/extension-youtube.
 */
export const Vimeo = Node.create<VimeoOptions>({
  name: "vimeo",
  addOptions() {
    return {
      allowFullscreen: true,
      width: 640,
      height: 360,
      HTMLAttributes: {},
    };
  },
  group: "block",
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      width: { default: this.options.width },
      height: { default: this.options.height },
    };
  },
  parseHTML() {
    return [
      { tag: "div[data-vimeo-video] iframe" },
      {
        tag: "iframe",
        getAttrs: (el) => {
          const node = el as HTMLIFrameElement;
          const s = (node.getAttribute("src") || "").trim();
          if (!s.includes("player.vimeo.com")) {
            return false;
          }
          return {
            src: s,
            width: node.getAttribute("width") ? Number.parseInt(node.getAttribute("width") || "", 10) : undefined,
            height: node.getAttribute("height") ? Number.parseInt(node.getAttribute("height") || "", 10) : undefined,
          };
        },
      },
    ];
  },
  addCommands() {
    return {
      setVimeoVideo:
        (options) =>
        ({ commands }) => {
          if (!isValidVimeoUrl(options.src)) {
            return false;
          }
          return commands.insertContent({
            type: this.name,
            attrs: { src: options.src, width: options.width, height: options.height },
          });
        },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const embed = embedSrcFromInput(String(HTMLAttributes.src || ""));
    if (!embed) {
      return ["div", { "data-vimeo-error": "1" }];
    }
    const w = HTMLAttributes.width ?? this.options.width;
    const h = HTMLAttributes.height ?? this.options.height;
    return [
      "div",
      { "data-vimeo-video": "" },
      [
        "iframe",
        mergeAttributes(
          {
            src: embed,
            width: w,
            height: h,
            frameborder: "0",
            allow: "autoplay; fullscreen; picture-in-picture; clipboard-write",
            ...(this.options.allowFullscreen ? { allowfullscreen: true } : {}),
            title: "Vídeo Vimeo",
            loading: "lazy",
            referrerpolicy: "strict-origin-when-cross-origin",
          },
          this.options.HTMLAttributes,
        ),
      ],
    ];
  },
});
