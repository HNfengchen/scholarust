// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "epubjs";
import { resolveImage } from "./layout/images";
import { extractEpubStructure, extractHtmlStructure } from "./structure";
import { sanitizeContentHtml } from "./contentHtml";

vi.mock("./layout/images", () => ({ resolveImage: vi.fn() }));
const raster = "data:image/png;base64,aGVsbG8=";
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const compact = (text: string) => text.replace(/\s+/g, " ").trim();

beforeEach(() => {
  vi.mocked(resolveImage).mockReset().mockResolvedValue(raster);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("semantic HTML structure", () => {
  it("keeps an entire table and ordered/nested lists without duplicate text", async () => {
    const result = await extractHtmlStructure(parse(`
      <table><caption>Results</caption><thead><tr><th scope="col">Name</th><th>Count</th></tr></thead>
      <tbody><tr><td rowspan="2"><strong>Alpha</strong></td><td>One</td></tr><tr><td>Two</td></tr></tbody></table>
      <ol start="3" reversed type="I"><li value="7">First<ul><li>Nested</li></ul></li><li>Last</li></ol>`));
    expect(result.blocks).toHaveLength(2);
    const table = parse(result.blocks[0].html!);
    expect(table.querySelectorAll("table")).toHaveLength(1);
    expect(table.querySelectorAll("tr")).toHaveLength(3);
    expect(table.querySelector("th")?.getAttribute("scope")).toBe("col");
    expect(table.querySelector("td")?.getAttribute("rowspan")).toBe("2");
    expect(table.querySelector("strong")?.textContent).toBe("Alpha");
    expect(compact(result.blocks[0].text)).toBe("Results Name Count Alpha One Two");
    const list = parse(result.blocks[1].html!);
    expect(list.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(list.querySelector("ol")?.getAttribute("type")).toBe("I");
    expect(list.querySelector("ol")?.hasAttribute("reversed")).toBe(true);
    expect(list.querySelector("ol > li")?.getAttribute("value")).toBe("7");
    expect(list.querySelector("ol > li > ul > li")?.textContent).toBe("Nested");
    expect(compact(result.blocks[1].text)).toBe("First Nested Last");
  });

  it("keeps mixed text/images in node order and resolves each image only once", async () => {
    const result = await extractHtmlStructure(parse('<p>before <strong>bold</strong><img src="images/a.png" alt="diagram"> after <em>end</em></p>'), { docId: "doc" });
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].kind).toBe("paragraph");
    const p = parse(result.blocks[0].html!).querySelector("p")!;
    expect(Array.from(p.childNodes).map((node) => node.nodeName)).toEqual(["#text", "STRONG", "IMG", "#text", "EM"]);
    expect(p.querySelector("img")?.src).toBe(raster);
    expect(result.blocks[0].text).toBe("before bolddiagram after end");
    expect(resolveImage).toHaveBeenCalledTimes(1);
    expect(resolveImage).toHaveBeenCalledWith("images/a.png", expect.any(String), "doc");
  });

  it("keeps all images and caption inside one figure, including image-only paragraphs", async () => {
    const result = await extractHtmlStructure(parse('<figure><img src="a.png" alt="A"><img src="b.png" alt="B"><figcaption>Caption</figcaption></figure><p><img src="c.png" alt="C"></p>'));
    expect(result.blocks.map((block) => block.kind)).toEqual(["figure", "figure"]);
    expect(parse(result.blocks[0].html!).querySelectorAll("img")).toHaveLength(2);
    expect(result.blocks[0].caption).toBe("Caption");
    expect(result.blocks[1].text).toBe("C");
    expect(resolveImage).toHaveBeenCalledTimes(3);
  });

  it("retains EPUB raster covers wrapped in SVG without mounting the SVG", async () => {
    const source = parse('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="cover.jpg"/></svg>');
    const script = source.createElementNS("http://www.w3.org/2000/svg", "script");
    script.textContent = "evil()";
    source.querySelector("svg")!.appendChild(script);
    const result = await extractHtmlStructure(source);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].html).toContain('<img');
    expect(result.blocks[0].html).not.toMatch(/svg|script|foreignObject|unsafe|evil/);
    expect(resolveImage).toHaveBeenCalledWith("cover.jpg", expect.any(String), undefined);
  });

  it("does not omit bare divs or text around nested blocks", async () => {
    const result = await extractHtmlStructure(parse('root<div>Before <em>inline</em><p>Paragraph</p>After<div>Nested <strong>bold</strong></div>Tail</div><div>Bare</div>end'));
    expect(result.blocks.map((block) => compact(block.text))).toEqual([
      "root", "Before inline", "Paragraph", "After", "Nested bold", "Tail", "Bare", "end",
    ]);
    expect(result.blocks.every((block) => Boolean(block.html))).toBe(true);
    expect(result.blocks[1].html).toContain("<em>inline</em>");
    expect(result.blocks[4].html).toContain("<strong>bold</strong>");
  });

  it("preserves code/pre, quotes, breaks and existing heading/note classification", async () => {
    const result = await extractHtmlStructure(parse('<h1>Title</h1><h1>Second</h1><h2>Abstract</h2><p>Abstract text</p><h3>Other</h3><blockquote><p><em>Quote</em><br>next</p></blockquote><pre><code>  const x = 1;\n  x++;</code></pre><div epub:type="footnote">Note</div><aside>Aside</aside>'));
    expect(result.blocks.map(({ kind, level }) => [kind, level])).toEqual([
      ["title", 0], ["heading", 1], ["heading", 2], ["abstract", 0], ["heading", 3],
      ["paragraph", 0], ["paragraph", 0], ["note", 0], ["note", 0],
    ]);
    expect(result.blocks[5].html).toBe("<blockquote><p><em>Quote</em><br>next</p></blockquote>");
    expect(result.blocks[5].text).toContain("Quote\nnext");
    expect(result.blocks[6].html).toContain("<pre><code>  const x = 1;\n  x++;</code></pre>");
  });

  it("rebuilds with an attribute/tag whitelist and excludes active content from text too", async () => {
    const source = document.createElement("template");
    source.innerHTML = `<p id="clobber" style="color:red" onclick="evil()">Safe<strong onmouseover="evil()">bold</strong>
      <script>secretScript</script><style>secretStyle</style><iframe>secretFrame</iframe><object>secretObject</object>
      <svg><foreignObject><p>secretSvg</p></foreignObject></svg><template>secretTemplate</template>
      <a href="jav&#x61;script:evil()" target="_blank">bad</a><a href="java&#9;script:evil()">tab</a>
      <a href="data:text/html,bad">data</a><a href="https://example.test/ok" onclick="evil()">good</a>
      <img src="javascript:evil()" onerror="evil()" srcset="https://bad.test/a" alt="blocked">
      <img src="data:image/svg+xml;base64,PHN2Zz4=" alt="vector"></p>`;
    const { fragment, notice } = await sanitizeContentHtml(source.content);
    const host = document.createElement("div");
    host.append(fragment);
    expect(host.querySelector("script,style,iframe,object,svg,template")).toBeNull();
    expect(host.innerHTML).not.toMatch(/onclick|onmouseover|onerror|srcset|style=|id=|target=|javascript:/i);
    expect(host.textContent).not.toContain("secret");
    expect(Array.from(host.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual([null, null, null, "https://example.test/ok"]);
    expect(Array.from(host.querySelectorAll("img")).every((img) => !img.hasAttribute("src"))).toBe(true);
    expect(notice).toContain("2 张图片");
    expect(resolveImage).not.toHaveBeenCalled();
    const structure = await extractHtmlStructure(source.content);
    expect(structure.blocks.map((block) => block.text).join("")).not.toContain("secret");
  });

  it.each([raster, "blob:https://example.test/image-id", "http://example.test/a.png", "https://example.test/a.png"])("allows readable raster/blob/http images: %s", async (url) => {
    vi.mocked(resolveImage).mockResolvedValue(url);
    const result = await extractHtmlStructure(parse(`<p><img src="${url}" alt="A"></p>`));
    expect(parse(result.blocks[0].html!).querySelector("img")?.getAttribute("src")).toBe(url);
    expect(result.notice).toBeUndefined();
  });

  it("retains alt and reports missing relative images and unsafe resolver output", async () => {
    vi.mocked(resolveImage).mockRejectedValueOnce(new Error("missing")).mockResolvedValueOnce("data:image/svg+xml;base64,PHN2Zz4=");
    const result = await extractHtmlStructure(parse('<p>before<img src="missing.png" alt="missing diagram">after</p><img src="other.png" alt="unsafe result">'));
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].text).toContain("missing diagram");
    expect(result.blocks[1].text).toBe("unsafe result");
    expect(result.blocks.every((block) => !parse(block.html!).querySelector("img")?.hasAttribute("src"))).toBe(true);
    expect(result.notice).toContain("2 张图片");
  });

  it("rejects pre-aborted extraction before reading any images", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(extractHtmlStructure(parse('<img src="a.png">'), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(resolveImage).not.toHaveBeenCalled();
  });

  it("yields to timer cancellation even inside a large single block", async () => {
    const controller = new AbortController();
    const source = parse(`<table><tbody>${"<tr><td>cell</td></tr>".repeat(2000)}</tbody></table>`);
    const timer = setTimeout(() => controller.abort(), 0);
    await expect(extractHtmlStructure(source, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    clearTimeout(timer);
  });

  it("cancels while image resolution is pending and does not swallow resolver aborts", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let rejectImage!: (error: Error) => void;
    vi.mocked(resolveImage).mockImplementation(() => {
      started();
      return new Promise((_resolve, reject) => { rejectImage = reject; });
    });
    const task = extractHtmlStructure(parse('<p><img src="a.png" alt="A"></p>'), { signal: controller.signal });
    await ready;
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    rejectImage(new Error("late image failure"));
    await Promise.resolve();
    vi.mocked(resolveImage).mockRejectedValue(new DOMException("cancel", "AbortError"));
    await expect(extractHtmlStructure(parse('<img src="a.png">'))).rejects.toMatchObject({ name: "AbortError" });
  });
});

function section(html = "<p>chapter</p>", loaded = false) {
  return {
    href: "chapter.xhtml", document: loaded ? parse(html) : undefined,
    contents: undefined, output: undefined,
    render: vi.fn(async () => html), unload: vi.fn(),
  };
}
function bookWith(sections: ReturnType<typeof section>[], toc: unknown[] = []): Book {
  return { opened: Promise.resolve(), loaded: { navigation: Promise.resolve({ toc }) }, spine: { spineItems: sections }, load: vi.fn() } as unknown as Book;
}

describe("EPUB extraction", () => {
  it("reports all-spine failures rather than silently returning an empty success", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sections = [section(), section()];
    sections.forEach((item) => item.render.mockRejectedValue(new Error("unreadable")));
    const onProgress = vi.fn();
    const result = await extractEpubStructure(bookWith(sections), { onProgress });
    expect(result.blocks).toEqual([]);
    expect(result.notice).toContain("2/2 个章节解析失败");
    expect(result.notice).toContain("未能提取任何章节");
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
    sections.forEach((item) => expect(item.unload).toHaveBeenCalledTimes(1));
  });

  it("collects part notices, counts partial failures and keeps loaded sections intact", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(resolveImage).mockRejectedValue(new Error("missing"));
    const displayed = section('<h1>Book</h1><p><img src="missing.png" alt="Picture"></p>', true);
    const failed = section();
    failed.render.mockRejectedValue(new Error("bad chapter"));
    const other = section("<h1>Later</h1><p>Chapter 3</p>");
    const result = await extractEpubStructure(bookWith([displayed, failed, other]));
    expect(displayed.unload).not.toHaveBeenCalled();
    expect(other.unload).toHaveBeenCalledTimes(1);
    expect(result.notice).toContain("1/3 个章节解析失败");
    expect(result.notice).toContain("chapter.xhtml：1 张图片");
    expect(result.blocks.map((block) => [block.id, block.kind])).toEqual([[0, "title"], [1, "figure"], [2, "heading"], [3, "heading"]]);
  });

  it("rethrows abort errors, stops the spine and never unloads a previously loaded chapter", async () => {
    const displayed = section("<p>visible</p>", true);
    displayed.render.mockRejectedValue(new DOMException("cancel", "AbortError"));
    const next = section();
    await expect(extractEpubStructure(bookWith([displayed, next]))).rejects.toMatchObject({ name: "AbortError" });
    expect(displayed.unload).not.toHaveBeenCalled();
    expect(next.render).not.toHaveBeenCalled();
  });

  it("propagates the signal into HTML extraction, including the last chapter", async () => {
    const controller = new AbortController();
    const current = section(`<div>${"<span>text</span>".repeat(2000)}</div>`);
    const timer = setTimeout(() => controller.abort(), 0);
    await expect(extractEpubStructure(bookWith([current]), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    clearTimeout(timer);
    expect(current.render).toHaveBeenCalledTimes(1);
    expect(current.unload).toHaveBeenCalledTimes(1);
  });

  it("can cancel before book.opened settles", async () => {
    const controller = new AbortController();
    const book = bookWith([]);
    book.opened = new Promise(() => {});
    const task = extractEpubStructure(book, { signal: controller.signal });
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
  });
});
