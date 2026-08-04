const MAX_SNAPSHOT_ELEMENTS = 200;
const SNAPSHOT_SELECTOR = [
  "button",
  "a[href]",
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role]",
  "h1",
  "h2",
  "h3",
  "p",
].join(",");

export function createPageId(cryptoObject = globalThis.crypto) {
  if (typeof cryptoObject?.randomUUID === "function") return cryptoObject.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoObject.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function safePageUrl(locationLike) {
  return `${locationLike.origin}${locationLike.pathname}`;
}

export function browserCommandRequestUrl(endpoint, pageId, locationLike, title) {
  const query = new URLSearchParams({
    page_id: pageId,
    url: safePageUrl(locationLike),
    title: String(title || "").slice(0, 500),
  });
  return `${endpoint}/browser/commands?${query}`;
}

export async function performBrowserAction(action, context) {
  const { document: pageDocument, window: pageWindow, host, allowedOrigin } = context;
  switch (action?.kind) {
    case "snapshot":
      return { value: snapshotPage(pageDocument, pageWindow, host) };
    case "screenshot": {
      if (typeof context.captureScreenshot !== "function") {
        throw new Error("Screenshot capture is unavailable");
      }
      return {
        value: { screenshotDataUrl: await context.captureScreenshot() },
      };
    }
    case "click": {
      const element = controlledElement(pageDocument, host, action.selector);
      ensureVisible(element, pageWindow);
      if (element.disabled || element.getAttribute?.("aria-disabled") === "true") {
        throw new Error("The selected element is disabled");
      }
      element.click();
      return { value: { element: describeElement(element), clicked: true } };
    }
    case "fill": {
      const element = controlledElement(pageDocument, host, action.selector);
      ensureVisible(element, pageWindow);
      fillElement(element, String(action.text ?? ""), pageWindow);
      return {
        value: {
          element: describeElement(element),
          filled: true,
          characters: Array.from(String(action.text ?? "")).length,
        },
      };
    }
    case "scroll": {
      if (action.selector) {
        const element = controlledElement(pageDocument, host, action.selector);
        element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
        return {
          value: {
            element: describeElement(element),
            scrollX: pageWindow.scrollX,
            scrollY: pageWindow.scrollY,
          },
        };
      }
      pageWindow.scrollTo({
        left: action.x ?? pageWindow.scrollX,
        top: action.y ?? pageWindow.scrollY,
        behavior: "auto",
      });
      return { value: { scrollX: pageWindow.scrollX, scrollY: pageWindow.scrollY } };
    }
    case "wait_for": {
      const timeoutMs = Math.max(1, Math.min(Number(context.timeoutMs) || 1, 24 * 60 * 60 * 1000));
      const deadline = Date.now() + timeoutMs;
      do {
        try {
          const element = controlledElement(pageDocument, host, action.selector);
          ensureVisible(element, pageWindow);
          return { value: { element: describeElement(element), visible: true } };
        } catch (error) {
          if (Date.now() >= deadline) throw error;
          await delay(50);
        }
      } while (Date.now() < deadline);
      throw new Error("The selected element did not become visible");
    }
    case "navigate": {
      const target = new URL(action.url, pageWindow.location.href);
      if (target.origin !== allowedOrigin) {
        throw new Error("Navigation must remain on the allowed origin");
      }
      return {
        value: { navigatingTo: safePageUrl(target) },
        afterAcknowledge: () => pageWindow.location.assign(target.href),
      };
    }
    case "reload":
      return {
        value: { reloading: safePageUrl(pageWindow.location) },
        afterAcknowledge: () => pageWindow.location.reload(),
      };
    default:
      throw new Error("Unsupported browser action");
  }
}

export function snapshotPage(pageDocument, pageWindow, host) {
  const candidates = Array.from(pageDocument.querySelectorAll(SNAPSHOT_SELECTOR));
  const elements = [];
  for (const element of candidates) {
    if (elements.length >= MAX_SNAPSHOT_ELEMENTS) break;
    if (!isControllable(element, host) || !isVisible(element, pageWindow)) continue;
    elements.push(describeElement(element));
  }
  return {
    url: safePageUrl(pageWindow.location),
    title: String(pageDocument.title || "").slice(0, 500),
    viewport: {
      width: pageWindow.innerWidth,
      height: pageWindow.innerHeight,
      scrollX: pageWindow.scrollX,
      scrollY: pageWindow.scrollY,
    },
    elements,
    truncated: candidates.length > elements.length && elements.length === MAX_SNAPSHOT_ELEMENTS,
  };
}

function controlledElement(pageDocument, host, selector) {
  let element;
  try {
    element = pageDocument.querySelector(selector);
  } catch {
    throw new Error("The browser action has an invalid CSS selector");
  }
  if (!element) throw new Error("No element matches the browser action selector");
  if (!isControllable(element, host)) {
    throw new Error("AgentNudge and redacted regions cannot be browser-control targets");
  }
  return element;
}

function isControllable(element, host) {
  if (element === host || host?.contains?.(element)) return false;
  if (element.closest?.("[data-agentnudge-redact]")) return false;
  return true;
}

function ensureVisible(element, pageWindow) {
  if (!isVisible(element, pageWindow)) throw new Error("The selected element is not visible");
}

function isVisible(element, pageWindow) {
  const rect = element.getBoundingClientRect();
  const style = pageWindow.getComputedStyle?.(element);
  return rect.width > 0
    && rect.height > 0
    && style?.display !== "none"
    && style?.visibility !== "hidden";
}

function fillElement(element, text, pageWindow) {
  const tag = String(element.tagName || "").toLowerCase();
  const type = String(element.type || "").toLowerCase();
  if (["password", "file", "hidden"].includes(type)) {
    throw new Error("Sensitive or file inputs cannot be filled through AgentNudge");
  }
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const prototype = tag === "textarea"
      ? pageWindow.HTMLTextAreaElement?.prototype
      : tag === "select"
        ? pageWindow.HTMLSelectElement?.prototype
        : pageWindow.HTMLInputElement?.prototype;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, text);
    else element.value = text;
  } else if (element.isContentEditable) {
    element.textContent = text;
  } else {
    throw new Error("The selected element is not editable");
  }
  element.dispatchEvent(new pageWindow.Event("input", { bubbles: true, composed: true }));
  element.dispatchEvent(new pageWindow.Event("change", { bubbles: true, composed: true }));
}

function describeElement(element) {
  const tag = String(element.tagName || "").toLowerCase();
  const formLike = ["input", "textarea", "select"].includes(tag) || element.isContentEditable;
  const text = formLike ? "" : normalizedText(element.textContent).slice(0, 500);
  const accessibleName = normalizedText(
    element.getAttribute?.("aria-label")
      || element.getAttribute?.("alt")
      || element.getAttribute?.("title")
      || element.labels?.[0]?.textContent
      || text,
  ).slice(0, 300);
  const rect = element.getBoundingClientRect();
  return {
    selector: cssSelector(element),
    tag,
    role: element.getAttribute?.("role") || null,
    accessibleName: accessibleName || null,
    text: text || null,
    disabled: Boolean(element.disabled || element.getAttribute?.("aria-disabled") === "true"),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}

function cssSelector(element) {
  if (element.id) return `#${escapeCss(element.id)}`;
  const parts = [];
  let current = element;
  while (current?.tagName && parts.length < 6) {
    let part = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((value) => value.tagName === current.tagName)
      : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    parts.unshift(part);
    if (current === current.ownerDocument?.body) break;
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function escapeCss(value) {
  if (globalThis.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
