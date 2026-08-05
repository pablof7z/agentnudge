import createDOMPurify from "dompurify";
import { marked } from "marked";

const ALLOWED_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
];

export function renderMarkdown(ownerDocument, source) {
  const root = ownerDocument.createElement("div");
  root.className = "message-markdown";
  const purifier = createDOMPurify(ownerDocument.defaultView);
  const parsed = marked.parse(String(source || ""), {
    async: false,
    breaks: true,
    gfm: true,
  });
  root.innerHTML = purifier.sanitize(parsed, {
    ALLOWED_ATTR: ["href", "title"],
    ALLOWED_TAGS,
    ALLOW_DATA_ATTR: false,
  });

  for (const link of root.querySelectorAll("a")) {
    const href = link.getAttribute("href");
    if (!href || !isSafeLinkHref(href)) {
      link.replaceWith(...link.childNodes);
      continue;
    }
    link.target = "_blank";
    link.rel = "nofollow noopener noreferrer";
  }
  return root;
}

export function isSafeLinkHref(value) {
  const href = String(value || "").trim();
  if (!href) return false;
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}
