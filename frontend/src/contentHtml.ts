import { resolveImage } from "./layout/images";

const ALLOWED_TAGS = new Set(
  ("p div span section article main header footer nav aside h1 h2 h3 h4 h5 h6 " +
    "strong b em i u s del ins mark small sub sup code pre blockquote q cite abbr " +
    "br hr wbr a figure figcaption img table caption colgroup col thead tbody tfoot tr th td " +
    "ol ul li dl dt dd").split(" "),
);
const DROP_TAGS = new Set(
  "head script style iframe object embed applet frame frameset template noscript svg math base link meta".split(" "),
);
const TEXT_BREAKS = new Set(
  "p div section article main header footer nav aside h1 h2 h3 h4 h5 h6 pre blockquote br hr figure figcaption table caption tr th td ol ul li dl dt dd".split(" "),
);

export function throwIfContentAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}

/** Stop waiting promptly, even when an image/book operation cannot itself be cancelled. */
export function waitForContent<T>(value: T | PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(value);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
    // Always observe the operation, including a late rejection after cancellation.
    Promise.resolve(value).then(
      (result) => { signal.removeEventListener("abort", aborted); resolve(result); },
      (error: unknown) => { signal.removeEventListener("abort", aborted); reject(error); },
    );
  });
}

/** A macrotask (not just a resolved promise) lets UI cancellation run. */
export function contentCheckpoint(signal?: AbortSignal): () => Promise<void> | undefined {
  let visited = 0;
  return () => {
    throwIfContentAborted(signal);
    if (++visited % 128 === 0) {
      return waitForContent(new Promise<void>((resolve) => setTimeout(resolve, 0)), signal);
    }
  };
}

function safeImageUrl(value: string): string | undefined {
  const url = value.trim();
  if (/^data:image\/(?:png|jpeg|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=\s]+$/i.test(url)) return url;
  if (/[\u0000-\u0020\u007f]/.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    if (["http:", "https:", "blob:"].includes(parsed.protocol)) return url;
  } catch { /* Relative sources must go through resolveImage first. */ }
  return undefined;
}

function safeHref(value: string): string | undefined {
  const url = value.trim();
  if (/[\u0000-\u0020\u007f]/.test(url)) return undefined;
  if (url.startsWith("#")) return url;
  try {
    if (["http:", "https:", "mailto:"].includes(new URL(url).protocol)) return url;
  } catch { /* Do not inherit the application's base URL. */ }
  return undefined;
}

function copyAttributes(source: Element, target: Element, tag: string): void {
  for (const name of ["title", "lang"]) {
    const value = source.getAttribute(name);
    if (value !== null) target.setAttribute(name, value);
  }
  const dir = source.getAttribute("dir");
  if (dir && /^(ltr|rtl|auto)$/.test(dir)) target.setAttribute("dir", dir);
  // Preserve note classification without copying arbitrary roles/classes/EPUB attributes.
  const noteTypes = (source.getAttribute("epub:type") ?? "").split(/\s+/);
  if (noteTypes.some((type) => type === "footnote" || type === "rearnote") ||
      ["doc-footnote", "doc-endnote"].includes(source.getAttribute("role") ?? "") ||
      source.classList.contains("footnote") || source.classList.contains("footnotes") ||
      source.id === "footnotes") {
    target.setAttribute("role", "doc-footnote");
  }
  if (tag === "a") {
    const href = safeHref(source.getAttribute("href") ?? "");
    if (href) target.setAttribute("href", href);
  }
  const numeric = tag === "ol" ? ["start"] : tag === "li" ? ["value"] :
    tag === "td" || tag === "th" ? ["colspan", "rowspan"] :
    tag === "col" || tag === "colgroup" ? ["span"] : tag === "img" ? ["width", "height"] : [];
  for (const name of numeric) {
    const value = source.getAttribute(name);
    if (value && /^-?\d{1,6}$/.test(value) &&
        (["start", "value"].includes(name) || Number(value) >= 0)) target.setAttribute(name, value);
  }
  if (tag === "ol") {
    if (source.hasAttribute("reversed")) target.setAttribute("reversed", "");
    const type = source.getAttribute("type");
    if (type && /^[1aAiI]$/.test(type)) target.setAttribute("type", type);
  }
  if (tag === "th") {
    const scope = source.getAttribute("scope");
    if (scope && /^(row|col|rowgroup|colgroup)$/.test(scope)) target.setAttribute("scope", scope);
  }
}

export interface ContentHtmlOptions {
  docId?: string;
  signal?: AbortSignal;
}

/** Rebuild into fresh HTML nodes. No source innerHTML, attributes or executable namespaces are trusted. */
export async function sanitizeContentHtml(
  root: ParentNode,
  options: ContentHtmlOptions = {},
): Promise<{ fragment: DocumentFragment; notice?: string }> {
  throwIfContentAborted(options.signal);
  const doc = document.implementation.createHTMLDocument("");
  const fragment = doc.createDocumentFragment();
  const checkpoint = contentCheckpoint(options.signal);
  const stack: { next: ChildNode | null; target: Node }[] = [{ next: root.firstChild, target: fragment }];
  let failedImages = 0;
  while (stack.length) {
    const pause = checkpoint();
    if (pause) await pause;
    const frame = stack[stack.length - 1];
    const source = frame.next;
    if (!source) { stack.pop(); continue; }
    frame.next = source.nextSibling;
    if (source.nodeType === 3) {
      frame.target.appendChild(doc.createTextNode(source.textContent ?? ""));
      continue;
    }
    if (source.nodeType !== 1) continue;
    const element = source as Element;
    const tag = element.localName.toLowerCase();
    if (tag === "svg" && element.namespaceURI === "http://www.w3.org/2000/svg") {
      const images = doc.createDocumentFragment();
      for (const sourceImage of element.querySelectorAll("image")) {
        const image = doc.createElement("img");
        image.setAttribute("src", sourceImage.getAttribute("href") ?? sourceImage.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "");
        image.setAttribute("alt", element.getAttribute("aria-label") ?? element.querySelector("title")?.textContent ?? "插图");
        images.appendChild(image);
      }
      stack.push({ next: images.firstChild, target: frame.target });
      continue;
    }
    if (DROP_TAGS.has(tag) || (element.namespaceURI && element.namespaceURI !== "http://www.w3.org/1999/xhtml")) continue;
    if (!ALLOWED_TAGS.has(tag)) {
      stack.push({ next: element.firstChild, target: frame.target });
      continue;
    }
    const target = doc.createElement(tag);
    copyAttributes(element, target, tag);
    frame.target.appendChild(target);
    if (tag === "img") {
      target.setAttribute("alt", element.getAttribute("alt") ?? "");
      target.setAttribute("loading", "lazy");
      target.setAttribute("decoding", "async");
      try {
        const raw = (element.getAttribute("src") ?? "").trim();
        const absolute = safeImageUrl(raw);
        // Only relative paths may enter document-image resolution. Never send an
        // unrecognised scheme (including SVG data) to the resolver or the DOM.
        if (!absolute && (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || /[\u0000-\u001f\u007f]/.test(raw))) {
          throw new Error("不安全的图片地址");
        }
        const img = element as HTMLImageElement;
        const resolved = safeImageUrl(img.currentSrc || img.src || "") ?? absolute ?? "";
        const input = raw.startsWith("//") ? safeImageUrl(`https:${raw}`) ?? raw : absolute ?? raw;
        const image = safeImageUrl(await waitForContent(resolveImage(input, resolved, options.docId), options.signal));
        if (!image) throw new Error("图片解析返回了不安全的地址");
        target.setAttribute("src", image);
      } catch (error) {
        throwIfContentAborted(options.signal);
        if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
        failedImages++;
        // Keep the img and its alt in place, even if the relative resource is missing.
      }
    } else {
      stack.push({ next: element.firstChild, target });
    }
  }
  throwIfContentAborted(options.signal);
  return { fragment, notice: failedImages ? `${failedImages} 张图片无法安全读取，已保留替代文本。` : undefined };
}

/** Text for translation, with cell/list/line boundaries and image alternatives. */
export function contentPlainText(root: Node): string {
  const parts: string[] = [];
  const stack: { node: Node; exit?: boolean }[] = [{ node: root }];
  while (stack.length) {
    const { node, exit } = stack.pop()!;
    if (node.nodeType === 3) { parts.push(node.textContent ?? ""); continue; }
    const tag = node.nodeType === 1 ? (node as Element).localName : "";
    if (tag === "br" || tag === "hr") { parts.push("\n"); continue; }
    if (TEXT_BREAKS.has(tag) && parts.length && !parts[parts.length - 1].endsWith("\n")) parts.push("\n");
    if (exit) continue;
    if (tag === "img") { parts.push((node as Element).getAttribute("alt") ?? ""); continue; }
    stack.push({ node, exit: true });
    for (let child = node.lastChild; child; child = child.previousSibling) stack.push({ node: child });
  }
  return parts.join("").trim();
}
