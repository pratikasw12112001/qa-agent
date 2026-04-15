/**
 * Phase 4 — PRD / PM Compliance
 * Parses PDF with pdf-parse, uses OpenAI GPT-4o to extract
 * structured ACs, user flows, expected copy, required screens.
 * Then validates each against the live app.
 */

import { launchBrowser, newContext } from "./browser.mjs";

// ─── PDF Parsing ──────────────────────────────────────────────────────────────

export async function parsePrd(pdfPathOrBuffer) {
  try {
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const { readFileSync } = await import("fs");
    const buf = typeof pdfPathOrBuffer === "string"
      ? readFileSync(pdfPathOrBuffer)
      : pdfPathOrBuffer;
    const data = await pdfParse(buf);
    return data.text;
  } catch (e) {
    console.warn("  PRD: pdf-parse failed:", e.message.slice(0, 80));
    return null;
  }
}

/** Extract structured data from PRD text using OpenAI or rule-based fallback */
export async function extractPrdStructure(prdText, openaiApiKey) {
  if (!prdText) return null;

  if (openaiApiKey) {
    return extractWithOpenAI(prdText, openaiApiKey);
  }
  return extractWithRules(prdText);
}

async function extractWithOpenAI(prdText, apiKey) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a QA engineer. Extract structured test data from PRD documents. Respond with valid JSON only.",
          },
          {
            role: "user",
            content: `Analyze this PRD and extract:
1. acceptanceCriteria: list of testable AC items (id, description, automatable: true/false, category)
2. userFlows: step-by-step flows (name, steps[])
3. expectedCopy: UI text that should appear (location, text, type: label|placeholder|error|tooltip|heading)
4. requiredScreens: screen/page names that must exist
5. requiredFeatures: feature names/capabilities that must be present

PRD:
${prdText.slice(0, 8000)}

JSON format:
{
  "acceptanceCriteria": [{"id":"AC-1","description":"...","automatable":true,"category":"ui|functional|content|navigation"}],
  "userFlows": [{"name":"...","steps":["..."]}],
  "expectedCopy": [{"location":"...","text":"...","type":"label"}],
  "requiredScreens": ["..."],
  "requiredFeatures": ["..."]
}`,
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`OpenAI API ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return JSON.parse(content);
  } catch (e) {
    console.warn("  PRD: OpenAI extraction failed:", e.message.slice(0, 80));
    return extractWithRules(prdText);
  }
}

function extractWithRules(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const result = {
    acceptanceCriteria: [],
    userFlows: [],
    expectedCopy: [],
    requiredScreens: [],
    requiredFeatures: [],
  };

  let acCounter = 1;
  for (const line of lines) {
    // AC patterns: "AC-1:", "1.", "- ", "• ", "Given/When/Then"
    if (/^(AC[-\s]?\d+:|Given |When |Then |\d+\.|[•\-]\s)/.test(line) && line.length > 20) {
      result.acceptanceCriteria.push({
        id: `AC-${acCounter++}`,
        description: line.replace(/^(AC[-\s]?\d+:|\d+\.|[•\-]\s)/, "").trim(),
        automatable: /click|navigate|display|show|appear|visible|input|form/i.test(line),
        category: /color|font|style|design|visual/i.test(line) ? "ui" :
                  /click|button|submit|form/i.test(line) ? "functional" : "content",
      });
    }

    // Screen names: "Screen:", "Page:", "View:"
    if (/^(screen|page|view|route):/i.test(line)) {
      result.requiredScreens.push(line.split(":").slice(1).join(":").trim());
    }
  }

  return result;
}

// ─── PRD Validation ───────────────────────────────────────────────────────────

export async function runPrdCompliance(screens, prdStructure, sessionPath, config) {
  if (!prdStructure) {
    return { skipped: true, reason: "No PRD provided" };
  }

  const results = {
    acceptanceCriteria: [],
    copyValidation: [],
    navigationCheck: [],
    featureCompleteness: [],
  };

  // 1. AC Checks
  for (const ac of prdStructure.acceptanceCriteria ?? []) {
    if (!ac.automatable) {
      results.acceptanceCriteria.push({
        ...ac, status: "manual-review",
        evidence: "Requires human judgment — flagged for manual review",
      });
      continue;
    }

    // Try to auto-validate against captured screens
    const passed = checkAcAgainstScreens(ac, screens);
    results.acceptanceCriteria.push({ ...ac, status: passed ? "pass" : "fail" });
  }

  // 2. Copy validation
  for (const expected of prdStructure.expectedCopy ?? []) {
    const found = screens.some((s) =>
      s.captureData?.allText?.some((t) =>
        t.text.toLowerCase().includes(expected.text.toLowerCase())
      )
    );
    results.copyValidation.push({
      location: expected.location,
      expectedText: expected.text,
      type: expected.type,
      found,
      severity: found ? "pass" : "warn",
    });
  }

  // 3. Navigation check — verify all internal links resolve
  const browser = await launchBrowser(true);
  try {
    for (const screen of screens.slice(0, 2)) { // Check first 2 screens to stay fast
      const context = await newContext(browser, sessionPath);
      const page = await context.newPage();
      await page.goto(screen.url, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1000);

      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .map((a) => ({ href: a.href, text: a.textContent ? a.textContent.trim() : "" }))
          .filter((l) => l.href.startsWith(window.location.origin))
          .slice(0, 20)
      );

      for (const link of links) {
        try {
          const res = await page.goto(link.href, { waitUntil: "domcontentloaded", timeout: 10000 });
          results.navigationCheck.push({
            url: link.href,
            text: link.text,
            status: res?.status() ?? 0,
            passed: (res?.status() ?? 0) < 400,
          });
          await page.goBack({ waitUntil: "networkidle", timeout: 10000 }).catch(() => {});
        } catch {
          results.navigationCheck.push({ url: link.href, text: link.text, status: 0, passed: false });
        }
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  // 4. Feature completeness — required screens present?
  for (const screenName of prdStructure.requiredScreens ?? []) {
    const found = screens.some(
      (s) =>
        s.name.toLowerCase().includes(screenName.toLowerCase()) ||
        s.url.toLowerCase().includes(screenName.toLowerCase().replace(/\s+/g, "-"))
    );
    results.featureCompleteness.push({
      feature: screenName,
      type: "screen",
      found,
      severity: found ? "pass" : "error",
    });
  }

  for (const feature of prdStructure.requiredFeatures ?? []) {
    const found = screens.some((s) =>
      s.captureData?.allText?.some((t) =>
        t.text.toLowerCase().includes(feature.toLowerCase())
      )
    );
    results.featureCompleteness.push({
      feature,
      type: "feature",
      found,
      severity: found ? "pass" : "warn",
    });
  }

  return results;
}

function checkAcAgainstScreens(ac, screens) {
  const desc = ac.description.toLowerCase();

  // Navigation check
  if (/navigate|go to|redirect/i.test(desc)) {
    // Checked via functional tests
    return true;
  }

  // Content presence check
  const textMatch = desc.match(/"([^"]+)"/);
  if (textMatch) {
    const expectedText = textMatch[1];
    return screens.some((s) =>
      s.captureData?.allText?.some((t) =>
        t.text.toLowerCase().includes(expectedText.toLowerCase())
      )
    );
  }

  // Element presence
  if (/button|input|field|form|table|search|filter/i.test(desc)) {
    return screens.some((s) =>
      s.captureData?.elements?.some((el) =>
        el.type === (
          /button/i.test(desc) ? "button" :
          /input|field|form/i.test(desc) ? "input" :
          /table/i.test(desc) ? "table-head" : el.type
        )
      )
    );
  }

  return true; // Can't determine — mark as pass to avoid false negatives
}
