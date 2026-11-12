const PAGE_NUMBER_LINE = /^[\s\-–—_.]*\d{1,4}[\s\-–—_.]*$/;
const CJK = /[\u3000-\u9fff\uff00-\uffef]/;

/**
 * OCR output wraps at visual line ends and sometimes repeats bare page
 * numbers; rejoin wrapped lines and drop the page-number noise.
 */
export function normalizeOcrText(text: string): string {
  const paragraphs: string[] = [];
  for (const group of text.split(/\n\s*\n/)) {
    const lines = group
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !PAGE_NUMBER_LINE.test(line));
    if (lines.length === 0) continue;
    let paragraph = lines[0];
    for (const line of lines.slice(1)) {
      // Chinese text is not separated by spaces, so only Latin joins get one.
      const glue = CJK.test(paragraph.slice(-1)) && CJK.test(line.charAt(0)) ? "" : " ";
      paragraph += glue + line;
    }
    paragraphs.push(paragraph);
  }
  return paragraphs.join("\n\n");
}