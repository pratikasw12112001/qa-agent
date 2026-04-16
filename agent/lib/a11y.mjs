/**
 * Accessibility scan via axe-core/playwright.
 * Returns array of { id, impact, description, nodes } filtered to error/serious violations.
 */

import AxeBuilder from "@axe-core/playwright";

export async function runAxeChecks(page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  return (results.violations || [])
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => ({
        target: n.target?.[0] ?? "",
        failureSummary: n.failureSummary?.slice(0, 200) ?? "",
      })),
    }));
}
