use pulldown_cmark::{html, Options, Parser};

pub fn render_markdown(source: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(source, options);
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out
}

pub fn render_text(source: &str) -> String {
    let escaped = source
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let normalized = escaped.replace("\r\n", "\n");
    let paragraphs: Vec<String> = normalized
        .split("\n\n")
        .map(|p| format!("<p>{}</p>", p.replace('\n', "<br>")))
        .collect();
    paragraphs.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_markdown_features() {
        let html = render_markdown("# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done");
        assert!(html.contains("<h1>Title</h1>"));
        assert!(html.contains("<table>"));
        assert!(html.contains("type=\"checkbox\""));
    }

    #[test]
    fn escapes_plain_text() {
        let html = render_text("a < b & c > d\n\nsecond para");
        assert!(html.contains("a &lt; b &amp; c &gt; d"));
        assert!(html.contains("<p>second para</p>"));
    }
}