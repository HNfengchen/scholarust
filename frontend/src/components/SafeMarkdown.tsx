import { Fragment } from "react";
import type { ReactNode } from "react";
import { marked } from "marked";

// Plugin READMEs are untrusted input rendered inside a webview that holds
// Tauri IPC privileges, so we never inject raw HTML. Instead we walk marked's
// tokens and emit React elements (React escapes all text), dropping any `html`
// token and restricting link protocols.
interface Tok {
  type: string;
  text?: string;
  depth?: number;
  tokens?: Tok[];
  items?: Tok[];
  ordered?: boolean;
  start?: number | "";
  href?: string;
  header?: { text?: string; tokens?: Tok[] }[];
  rows?: { text?: string; tokens?: Tok[] }[][];
}

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const protocol = new URL(href).protocol;
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") {
      return href;
    }
  } catch {
    /* relative or malformed — treat as plain text */
  }
  return null;
}

function renderTokens(tokens: Tok[] | undefined): ReactNode {
  if (!tokens) return null;
  return tokens.map((token, index) => (
    <Fragment key={index}>{renderToken(token)}</Fragment>
  ));
}

function renderTable(token: Tok): ReactNode {
  const cell = (
    c: { text?: string; tokens?: Tok[] } | undefined,
    index: number,
    isHeader: boolean,
  ) => {
    const content = c?.tokens ? renderTokens(c.tokens) : (c?.text ?? "");
    return isHeader ? <th key={index}>{content}</th> : <td key={index}>{content}</td>;
  };
  return (
    <table>
      <thead>
        <tr>{(token.header ?? []).map((c, i) => cell(c, i, true))}</tr>
      </thead>
      <tbody>
        {(token.rows ?? []).map((row, r) => (
          <tr key={r}>{row.map((c, i) => cell(c, i, false))}</tr>
        ))}
      </tbody>
    </table>
  );
}

function renderToken(token: Tok): ReactNode {
  switch (token.type) {
    case "heading": {
      const depth = Math.min(Math.max(token.depth ?? 1, 1), 6);
      const Tag = `h${depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag>{renderTokens(token.tokens)}</Tag>;
    }
    case "paragraph":
      return <p>{renderTokens(token.tokens)}</p>;
    case "blockquote":
      return <blockquote>{renderTokens(token.tokens)}</blockquote>;
    case "list": {
      const items = (token.items ?? []).map((item, index) => (
        <li key={index}>{renderTokens(item.tokens)}</li>
      ));
      return token.ordered ? (
        <ol start={typeof token.start === "number" ? token.start : undefined}>{items}</ol>
      ) : (
        <ul>{items}</ul>
      );
    }
    case "code":
      return (
        <pre>
          <code>{token.text ?? ""}</code>
        </pre>
      );
    case "codespan":
      return <code>{token.text ?? ""}</code>;
    case "strong":
      return <strong>{renderTokens(token.tokens)}</strong>;
    case "em":
      return <em>{renderTokens(token.tokens)}</em>;
    case "del":
      return <del>{renderTokens(token.tokens)}</del>;
    case "link": {
      const href = safeHref(token.href);
      const inner = renderTokens(token.tokens);
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {inner}
        </a>
      ) : (
        inner
      );
    }
    case "image":
      return token.text ?? "";
    case "table":
      return renderTable(token);
    case "hr":
      return <hr />;
    case "br":
      return <br />;
    case "escape":
      return token.text ?? "";
    case "space":
    case "html":
      return null;
    case "text":
      return token.tokens ? renderTokens(token.tokens) : (token.text ?? "");
    default:
      return token.tokens ? renderTokens(token.tokens) : (token.text ?? "");
  }
}

export default function SafeMarkdown({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  const tokens = marked.lexer(markdown) as unknown as Tok[];
  return <div className={className}>{renderTokens(tokens)}</div>;
}