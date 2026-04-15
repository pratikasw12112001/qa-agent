/**
 * Playwright capture module
 * - Takes full-page screenshot
 * - Extracts all meaningful elements with computed styles + bounding boxes
 * - Takes annotated screenshot (with colored boxes for findings)
 */

import { launchBrowser, newContext } from "./browser.mjs";

const ELEMENT_QUERIES = [
  { type: "heading",     sel: "h1, h2, h3, h4, h5, h6" },
  { type: "button",      sel: "button, [role='button'], a.btn, .ant-btn" },
  { type: "input",       sel: "input, textarea, select, .ant-input, .ant-select" },
  { type: "nav",         sel: ".ant-menu-item, [role='menuitem'], nav a, .sidebar a" },
  { type: "table-head",  sel: "th, .ant-table-column-title" },
  { type: "table-row",   sel: "tr.ant-table-row, tbody tr" },
  { type: "card",        sel: ".ant-card, [class*='card'], [class*='panel']" },
  { type: "badge",       sel: ".ant-badge, [class*='badge'], [class*='tag']" },
  { type: "modal",       sel: ".ant-modal-content, [role='dialog']" },
  { type: "page-title",  sel: "h1, .ant-page-header-heading-title, [class*='page-title']" },
];

export async function captureScreen(url, sessionPath, viewport = { width: 1440, height: 900 }) {
  const browser = await launchBrowser(true);
  try {
    const context = await newContext(browser, sessionPath, viewport);
    const page = await context.newPage();

    // Capture console errors
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // Capture failed requests
    const failedRequests = [];
    page.on("requestfailed", (req) => {
      failedRequests.push({ url: req.url(), reason: req.failure()?.errorText });
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);

    // Full page screenshot (clean)
    const fullPageBuf = await page.screenshot({ fullPage: true, type: "png" });

    // Extract all elements with styles
    const elements = await extractElements(page);

    // Performance metrics
    const perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const paint = performance.getEntriesByType("paint");
      const lcp = performance.getEntriesByType("largest-contentful-paint");
      const shifts = performance.getEntriesByType("layout-shift");
      return {
        loadTime: nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
        fcp: Math.round(paint.find((p) => p.name === "first-contentful-paint")?.startTime ?? 0),
        lcp: Math.round(lcp[lcp.length - 1]?.startTime ?? 0),
        cls: parseFloat(shifts.reduce((s, e) => s + e.value, 0).toFixed(4)),
        ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
      };
    });

    // All links on the page
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        href: a.href,
        text: a.textContent?.trim().slice(0, 60),
        isInternal: a.href.startsWith(window.location.origin),
      }))
    );

    // All images
    const images = await page.evaluate(() =>
      Array.from(document.querySelectorAll("img")).map((img) => ({
        src: img.src,
        alt: img.alt,
        loaded: img.complete && img.naturalWidth > 0,
      }))
    );

    // Active nav item
    const activeNav = await page.evaluate(() => {
      const active = document.querySelector(
        ".ant-menu-item-selected, [aria-selected='true'], .active, [class*='active']"
      );
      return active?.textContent?.trim() ?? null;
    });

    // All text content (for copy validation)
    const allText = await page.evaluate(() => {
      const nodes = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        const parent = node.parentElement;
        if (text && text.length > 1 && parent && !["SCRIPT","STYLE"].includes(parent.tagName)) {
          const r = parent.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            nodes.push({
              text,
              tag: parent.tagName.toLowerCase(),
              selector: getSelector(parent),
            });
          }
        }
      }
      return nodes.slice(0, 200);

      function getSelector(el) {
        if (el.id) return `#${el.id}`;
        const cls = Array.from(el.classList)
          .filter((c) => !c.match(/^(ant-|css-)/))
          .slice(0, 2)
          .join(".");
        return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
      }
    });

    await context.close();

    return {
      url,
      viewport,
      fullPageScreenshot: fullPageBuf.toString("base64"),
      elements,
      perf,
      links,
      images,
      activeNav,
      allText,
      consoleErrors,
      failedRequests,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}

/** Capture a screenshot with colored boxes drawn over findings */
export async function captureAnnotated(url, sessionPath, findings, viewport = { width: 1440, height: 900 }) {
  const browser = await launchBrowser(true);
  try {
    const context = await newContext(browser, sessionPath, viewport);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);

    // Inject CSS highlights for each finding that has a selector
    await page.evaluate((items) => {
      const style = document.createElement("style");
      style.id = "__qa_annotations__";
      const rules = items.map((f) => {
        if (!f.selector) return "";
        const color = f.severity === "error" ? "#ef4444" : f.severity === "warn" ? "#f59e0b" : "#22c55e";
        return `${f.selector} { outline: 3px solid ${color} !important; outline-offset: 2px !important; }`;
      }).join("\n");
      style.textContent = rules;
      document.head.appendChild(style);
    }, findings.filter((f) => f.selector));

    const annotatedBuf = await page.screenshot({ fullPage: true, type: "png" });

    // Remove annotations
    await page.evaluate(() => {
      document.getElementById("__qa_annotations__")?.remove();
    });

    await context.close();
    return annotatedBuf.toString("base64");
  } finally {
    await browser.close();
  }
}

/** Navigate to a screen via interactions (for screens that require click-through) */
export async function navigateToScreen(baseUrl, navigationSteps, sessionPath) {
  const browser = await launchBrowser(true);
  try {
    const context = await newContext(browser, sessionPath);
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);

    for (const step of navigationSteps) {
      if (step.type === "click") {
        const loc = page.locator(step.selector).first();
        if ((await loc.count()) > 0) {
          await loc.click();
          await page.waitForTimeout(1500);
          if (step.waitForSelector) {
            await page.waitForSelector(step.waitForSelector, { timeout: 5000 }).catch(() => {});
          }
        }
      } else if (step.type === "goto") {
        await page.goto(step.url, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1500);
      }
    }

    const finalUrl = page.url();
    const buf = await page.screenshot({ fullPage: true, type: "png" });
    await context.close();
    return { url: finalUrl, screenshotBase64: buf.toString("base64") };
  } finally {
    await browser.close();
  }
}

// ─── Element Extraction ───────────────────────────────────────────────────────

async function extractElements(page) {
  const elements = [];
  const seen = new Set();

  for (const { type, sel } of ELEMENT_QUERIES) {
    const count = await page.locator(sel).count();
    const limit = Math.min(count, type === "table-row" ? 3 : 20);

    for (let i = 0; i < limit; i++) {
      const locator = page.locator(sel).nth(i);
      try {
        const data = await locator.evaluate((el, elType) => {
          const cs = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return null;

          // Build a stable selector
          let selector = elType === "heading" || elType === "button"
            ? el.tagName.toLowerCase()
            : el.tagName.toLowerCase();
          if (el.id) selector = `#${el.id}`;
          else if (el.className && typeof el.className === "string") {
            const cls = el.className.trim().split(/\s+/).slice(0, 2).join(".");
            if (cls) selector = `${el.tagName.toLowerCase()}.${cls}`;
          }

          return {
            type: elType,
            selector,
            text: el.textContent?.trim().slice(0, 200) ?? null,
            placeholder: el.placeholder ?? null,
            ariaLabel: el.getAttribute("aria-label"),
            bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            styles: {
              fontFamily: cs.fontFamily,
              fontSize: parseFloat(cs.fontSize),
              fontWeight: parseFloat(cs.fontWeight),
              lineHeight: parseFloat(cs.lineHeight),
              letterSpacing: parseFloat(cs.letterSpacing) || 0,
              color: cs.color,
              backgroundColor: cs.backgroundColor,
              borderRadius: parseFloat(cs.borderRadius) || 0,
              borderColor: cs.borderColor,
              borderWidth: parseFloat(cs.borderWidth) || 0,
              boxShadow: cs.boxShadow === "none" ? null : cs.boxShadow,
              opacity: parseFloat(cs.opacity),
              paddingTop: parseFloat(cs.paddingTop) || 0,
              paddingRight: parseFloat(cs.paddingRight) || 0,
              paddingBottom: parseFloat(cs.paddingBottom) || 0,
              paddingLeft: parseFloat(cs.paddingLeft) || 0,
              gap: parseFloat(cs.gap) || null,
            },
          };
        }, type);

        if (data && !seen.has(`${data.bbox.x},${data.bbox.y}`)) {
          seen.add(`${data.bbox.x},${data.bbox.y}`);
          elements.push(data);
        }
      } catch {
        // Element may have been removed from DOM
      }
    }
  }

  return elements;
}
