/**
 * Phase 3 — QA Completeness
 * Accessibility (WCAG AA), Responsiveness, Performance,
 * State coverage, Console errors, Broken images/links
 */

import { launchBrowser, newContext } from "./browser.mjs";
import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const require = createRequire(import.meta.url);

async function getAxeSource() {
  try {
    const axePath = require.resolve("axe-core/axe.min.js");
    return readFileSync(axePath, "utf8");
  } catch {
    // Fallback: minimal axe-core check via built-in browser APIs
    return null;
  }
}

export async function runQAChecks(screen, sessionPath, config) {
  const [accessibility, responsiveness, performance, states] = await Promise.all([
    checkAccessibility(screen.url, sessionPath),
    checkResponsiveness(screen.url, sessionPath),
    checkPerformance(screen.url, sessionPath),
    checkStates(screen.url, sessionPath),
  ]);

  return { accessibility, responsiveness, performance, states };
}

// ─── Accessibility ────────────────────────────────────────────────────────────

export async function checkAccessibility(url, sessionPath) {
  const browser = await launchBrowser(true);
  const findings = [];

  try {
    const context = await newContext(browser, sessionPath);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);

    // Inject axe-core and run
    const axeSource = await getAxeSource();
    let axeResults = null;

    if (axeSource) {
      await page.evaluate(axeSource);
      axeResults = await page.evaluate(async () => {
        return await (window as any).axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
        });
      });
    }

    // Manual checks (always run, regardless of axe)
    const manual = await page.evaluate(() => {
      const issues = [];

      // 1. Images missing alt text
      document.querySelectorAll("img").forEach((img) => {
        if (!img.alt && !img.getAttribute("aria-label") && !img.getAttribute("role")) {
          issues.push({
            type: "missing-alt",
            severity: "error",
            element: img.outerHTML.slice(0, 100),
            description: "Image missing alt text",
            wcag: "1.1.1",
          });
        }
      });

      // 2. Form inputs without labels
      document.querySelectorAll("input, textarea, select").forEach((input) => {
        const id = (input as HTMLElement).id;
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const hasAriaLabel = input.getAttribute("aria-label") || input.getAttribute("aria-labelledby");
        const hasPlaceholder = (input as HTMLInputElement).placeholder;
        if (!hasLabel && !hasAriaLabel && !hasPlaceholder) {
          issues.push({
            type: "missing-label",
            severity: "error",
            element: input.outerHTML.slice(0, 100),
            description: "Form input has no label, aria-label, or placeholder",
            wcag: "1.3.1",
          });
        }
      });

      // 3. Buttons with no accessible name
      document.querySelectorAll("button, [role='button']").forEach((btn) => {
        const text = (btn as HTMLElement).textContent?.trim();
        const ariaLabel = btn.getAttribute("aria-label");
        const ariaLabelledby = btn.getAttribute("aria-labelledby");
        if (!text && !ariaLabel && !ariaLabelledby) {
          issues.push({
            type: "empty-button",
            severity: "error",
            element: (btn as HTMLElement).outerHTML.slice(0, 100),
            description: "Button has no accessible name",
            wcag: "4.1.2",
          });
        }
      });

      // 4. Color contrast (spot check on text elements)
      const contrastIssues = [];
      const textEls = Array.from(document.querySelectorAll("p, span, td, th, label, button, h1, h2, h3"));
      for (const el of textEls.slice(0, 20)) {
        const cs = window.getComputedStyle(el as HTMLElement);
        const color = cs.color;
        const bg = cs.backgroundColor;
        if (color && bg && color !== "rgba(0, 0, 0, 0)" && bg !== "rgba(0, 0, 0, 0)") {
          const parseRGB = (str: string) => {
            const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            return m ? [+m[1], +m[2], +m[3]] : null;
          };
          const toL = (rgb: number[]) => {
            const [r, g, b] = rgb.map((v) => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const fg = parseRGB(color);
          const bk = parseRGB(bg);
          if (fg && bk) {
            const l1 = toL(fg);
            const l2 = toL(bk);
            const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            const fontSize = parseFloat(cs.fontSize);
            const isBold = parseFloat(cs.fontWeight) >= 700;
            const isLarge = fontSize >= 18 || (isBold && fontSize >= 14);
            const required = isLarge ? 3 : 4.5;
            if (ratio < required) {
              contrastIssues.push({
                type: "contrast",
                severity: "error",
                element: (el as HTMLElement).outerHTML.slice(0, 80),
                description: `Contrast ratio ${ratio.toFixed(2)}:1 below WCAG AA minimum ${required}:1`,
                wcag: "1.4.3",
                detail: { ratio: ratio.toFixed(2), required, color, background: bg },
              });
            }
          }
        }
      }
      issues.push(...contrastIssues.slice(0, 10));

      // 5. Page has a main landmark
      if (!document.querySelector("main, [role='main']")) {
        issues.push({
          type: "no-main",
          severity: "warn",
          element: "<body>",
          description: "Page has no <main> landmark",
          wcag: "1.3.6",
        });
      }

      // 6. Skip link
      const firstLink = document.querySelector("a");
      if (firstLink && !firstLink.href?.includes("#")) {
        issues.push({
          type: "no-skip-link",
          severity: "warn",
          element: "<body>",
          description: "No skip-navigation link found",
          wcag: "2.4.1",
        });
      }

      return issues;
    });

    // Combine axe results with manual
    if (axeResults) {
      for (const violation of axeResults.violations ?? []) {
        findings.push({
          type: violation.id,
          severity: violation.impact === "critical" || violation.impact === "serious" ? "error" : "warn",
          description: violation.description,
          wcag: violation.tags?.find((t: string) => t.startsWith("wcag"))?.toUpperCase() ?? "",
          element: violation.nodes?.[0]?.html?.slice(0, 100) ?? "",
          detail: { impact: violation.impact, help: violation.help },
        });
      }
    }

    findings.push(...manual);
    await context.close();
  } finally {
    await browser.close();
  }

  return findings;
}

// ─── Responsiveness ───────────────────────────────────────────────────────────

export async function checkResponsiveness(url, sessionPath) {
  const viewports = [
    { label: "mobile",  width: 375,  height: 812 },
    { label: "tablet",  width: 768,  height: 1024 },
    { label: "desktop", width: 1440, height: 900 },
  ];

  const results = [];
  const browser = await launchBrowser(true);

  try {
    for (const vp of viewports) {
      const context = await newContext(browser, sessionPath, { width: vp.width, height: vp.height });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(1500);

      const screenshot = await page.screenshot({ fullPage: true, type: "png" });

      const issues = await page.evaluate(() => {
        const problems = [];
        const body = document.body;
        const bodyWidth = body.scrollWidth;
        const windowWidth = window.innerWidth;

        // Horizontal overflow
        if (bodyWidth > windowWidth + 2) {
          problems.push({
            type: "horizontal-overflow",
            severity: "error",
            description: `Page overflows horizontally by ${bodyWidth - windowWidth}px`,
          });
        }

        // Elements wider than viewport
        document.querySelectorAll("*").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right > windowWidth + 10 && r.width > 50) {
            problems.push({
              type: "element-overflow",
              severity: "warn",
              description: `Element overflows viewport: ${(el as HTMLElement).tagName}.${(el as HTMLElement).className?.toString().slice(0, 30)}`,
            });
          }
        });

        // Touch targets too small (mobile only)
        if (window.innerWidth <= 768) {
          document.querySelectorAll("button, a, [role='button']").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)) {
              problems.push({
                type: "small-touch-target",
                severity: "warn",
                description: `Touch target ${Math.round(r.width)}×${Math.round(r.height)}px — should be ≥44×44px`,
              });
            }
          });
        }

        return problems.slice(0, 10);
      });

      results.push({
        viewport: vp,
        screenshot: screenshot.toString("base64"),
        issues,
      });

      await context.close();
    }
  } finally {
    await browser.close();
  }

  return results;
}

// ─── Performance ─────────────────────────────────────────────────────────────

export async function checkPerformance(url, sessionPath) {
  const browser = await launchBrowser(true);
  try {
    const context = await newContext(browser, sessionPath);
    const page = await context.newPage();

    const start = Date.now();
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    const loadMs = Date.now() - start;

    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const paint = performance.getEntriesByType("paint");
      const lcp = performance.getEntriesByType("largest-contentful-paint") as any[];
      const cls = performance.getEntriesByType("layout-shift") as any[];
      return {
        ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
        fcp: Math.round(paint.find((p) => p.name === "first-contentful-paint")?.startTime ?? 0),
        lcp: Math.round(lcp[lcp.length - 1]?.startTime ?? 0),
        cls: parseFloat(cls.reduce((s, e) => s + e.value, 0).toFixed(4)),
        domInteractive: nav ? Math.round(nav.domInteractive - nav.startTime) : null,
        totalRequests: performance.getEntriesByType("resource").length,
      };
    });

    // Broken images
    const brokenImages = await page.evaluate(() =>
      Array.from(document.querySelectorAll("img"))
        .filter((img) => !img.complete || img.naturalWidth === 0)
        .map((img) => img.src).slice(0, 10)
    );

    // Console errors already captured in captureScreen; re-collect here
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await context.close();

    const ratings = {
      lcp:  metrics.lcp <= 2500 ? "good" : metrics.lcp <= 4000 ? "needs-improvement" : "poor",
      cls:  metrics.cls <= 0.1  ? "good" : metrics.cls <= 0.25  ? "needs-improvement" : "poor",
      fcp:  metrics.fcp <= 1800 ? "good" : metrics.fcp <= 3000  ? "needs-improvement" : "poor",
      ttfb: metrics.ttfb != null && metrics.ttfb <= 800 ? "good" : "needs-improvement",
    };

    return { loadMs, ...metrics, ratings, brokenImages, consoleErrors };
  } finally {
    await browser.close();
  }
}

// ─── State Coverage ───────────────────────────────────────────────────────────

export async function checkStates(url, sessionPath) {
  const browser = await launchBrowser(true);
  const states = [];

  try {
    // 1. Default loaded state
    const ctx1 = await newContext(browser, sessionPath);
    const p1 = await ctx1.newPage();
    await p1.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await p1.waitForTimeout(1500);
    const defaultShot = await p1.screenshot({ type: "png" });
    states.push({ name: "Default", screenshot: defaultShot.toString("base64"), issues: [] });
    await ctx1.close();

    // 2. Hover state on first interactive element
    const ctx2 = await newContext(browser, sessionPath);
    const p2 = await ctx2.newPage();
    await p2.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await p2.waitForTimeout(1000);
    try {
      const btn = p2.locator("button, .ant-btn, a").first();
      if ((await btn.count()) > 0) {
        await btn.hover();
        await p2.waitForTimeout(300);
        const hoverShot = await p2.screenshot({ type: "png" });
        states.push({ name: "Hover (first button)", screenshot: hoverShot.toString("base64"), issues: [] });
      }
    } catch {}
    await ctx2.close();

    // 3. Loading state — simulate slow network
    const ctx3 = await newContext(browser, sessionPath);
    const p3 = await ctx3.newPage();
    await p3.route("**/*", (route) => route.continue());
    const cdp = await ctx3.newCDPSession(p3);
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: 50000, // 50kbps
      uploadThroughput: 50000,
      latency: 1000,
    });
    p3.goto(url, { waitUntil: "commit", timeout: 10000 }).catch(() => {});
    await p3.waitForTimeout(800); // capture mid-load
    const loadShot = await p3.screenshot({ type: "png" });
    states.push({ name: "Loading (slow network)", screenshot: loadShot.toString("base64"), issues: [] });
    await ctx3.close();

    // 4. Empty search state
    const ctx4 = await newContext(browser, sessionPath);
    const p4 = await ctx4.newPage();
    await p4.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await p4.waitForTimeout(1000);
    try {
      const searchSel = 'input[type="search"], .ant-input, input[placeholder*="earch" i]';
      if ((await p4.locator(searchSel).count()) > 0) {
        await p4.fill(searchSel, "xyzzy_nonexistent_12345");
        await p4.waitForTimeout(1000);
        const emptyShot = await p4.screenshot({ type: "png" });
        const emptyState = await p4.evaluate(() => {
          const el = document.querySelector(".ant-empty, [class*='empty'], [class*='no-data']");
          return el ? el.textContent?.trim() : null;
        });
        states.push({
          name: "Empty search results",
          screenshot: emptyShot.toString("base64"),
          issues: emptyState ? [] : [{ type: "no-empty-state", severity: "warn", description: "No empty state UI found for zero results" }],
        });
      }
    } catch {}
    await ctx4.close();

  } finally {
    await browser.close();
  }

  return states;
}
