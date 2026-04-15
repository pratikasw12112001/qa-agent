/**
 * Phase 1 — Visual Comparison
 * Compares matched Figma node ↔ live element pairs across:
 * Typography, Color, Spacing, Size, Presence
 */

// ─── Tolerance helpers ────────────────────────────────────────────────────────

function numSeverity(delta, thresholds) {
  const abs = Math.abs(delta);
  if (abs >= thresholds.error) return "error";
  if (abs >= thresholds.warn) return "warn";
  return "pass";
}

function colorDeltaE(a, b) {
  const parseColor = (str) => {
    if (!str) return null;
    const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  };
  const toXyz = ({ r, g, b }) => {
    const s = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const R = s(r), G = s(g), B = s(b);
    return {
      x: (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047,
      y: (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0,
      z: (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883,
    };
  };
  const toLab = ({ x, y, z }) => {
    const f = (t) => (t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116);
    return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
  };
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return 999;
  const la = toLab(toXyz(ca));
  const lb = toLab(toXyz(cb));
  return Math.sqrt((la.L - lb.L) ** 2 + (la.a - lb.a) ** 2 + (la.b - lb.b) ** 2);
}

function colorSeverity(a, b, thresholds) {
  if (!a || !b) return "pass";
  const de = colorDeltaE(a, b);
  if (de >= thresholds.visual.colorDeltaE.error) return "error";
  if (de >= thresholds.visual.colorDeltaE.warn) return "warn";
  return "pass";
}

// ─── Phase 1: Per-pair comparisons ───────────────────────────────────────────

export function compareTypography(figma, live, thresholds) {
  const findings = [];
  const tv = thresholds.visual;
  const base = { category: "typography", figmaNodeId: figma.id, figmaNodeName: figma.name, selector: live.selector };

  // Font family
  if (figma.styles.fontFamily && live.styles.fontFamily) {
    const figmaFont = figma.styles.fontFamily.toLowerCase().replace(/['"]/g, "").split(",")[0].trim();
    const liveFont = live.styles.fontFamily.toLowerCase().replace(/['"]/g, "").split(",")[0].trim();
    if (figmaFont !== liveFont && !liveFont.includes(figmaFont) && !figmaFont.includes(liveFont)) {
      findings.push({
        ...base, severity: "error", property: "font-family",
        figmaValue: figma.styles.fontFamily, liveValue: live.styles.fontFamily, delta: "mismatch",
        description: `Font should be "${figmaFont}" but is "${liveFont}"`,
      });
    }
  }

  // Font size
  if (figma.styles.fontSize != null && live.styles.fontSize != null) {
    const delta = live.styles.fontSize - figma.styles.fontSize;
    const severity = numSeverity(delta, tv.fontSizeDeltaPx);
    if (severity !== "pass") findings.push({
      ...base, severity, property: "font-size",
      figmaValue: `${figma.styles.fontSize}px`, liveValue: `${live.styles.fontSize}px`,
      delta: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}px`,
      description: `Font size should be ${figma.styles.fontSize}px but is ${live.styles.fontSize}px`,
    });
  }

  // Font weight
  if (figma.styles.fontWeight != null && live.styles.fontWeight != null) {
    const delta = live.styles.fontWeight - figma.styles.fontWeight;
    if (Math.abs(delta) >= 100) findings.push({
      ...base, severity: "warn", property: "font-weight",
      figmaValue: String(figma.styles.fontWeight), liveValue: String(live.styles.fontWeight),
      delta: String(delta),
      description: `Font weight should be ${figma.styles.fontWeight} but is ${live.styles.fontWeight}`,
    });
  }

  // Line height
  if (figma.styles.lineHeight != null && live.styles.lineHeight != null) {
    const delta = live.styles.lineHeight - figma.styles.lineHeight;
    const severity = numSeverity(delta, tv.lineHeightDeltaPx);
    if (severity !== "pass") findings.push({
      ...base, severity, property: "line-height",
      figmaValue: `${figma.styles.lineHeight}px`, liveValue: `${live.styles.lineHeight}px`,
      delta: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}px`,
      description: `Line height should be ${figma.styles.lineHeight}px but is ${live.styles.lineHeight}px`,
    });
  }

  return findings;
}

export function compareColors(figma, live, thresholds) {
  const findings = [];
  const base = { category: "color", figmaNodeId: figma.id, figmaNodeName: figma.name, selector: live.selector };

  const checks = [
    { prop: "background-color", figmaVal: figma.styles.backgroundColor, liveVal: live.styles.backgroundColor },
    { prop: "color",            figmaVal: figma.styles.color,            liveVal: live.styles.color },
    { prop: "border-color",     figmaVal: figma.styles.borderColor,      liveVal: live.styles.borderColor },
  ];

  for (const { prop, figmaVal, liveVal } of checks) {
    if (!figmaVal || !liveVal) continue;
    const severity = colorSeverity(figmaVal, liveVal, thresholds);
    if (severity !== "pass") {
      const de = colorDeltaE(figmaVal, liveVal).toFixed(2);
      findings.push({
        ...base, severity, property: prop,
        figmaValue: figmaVal, liveValue: liveVal, delta: `ΔE ${de}`,
        description: `${prop} differs by ΔE ${de} (design: ${figmaVal}, live: ${liveVal})`,
      });
    }
  }

  // Box shadow presence
  if (figma.styles.boxShadow && !live.styles.boxShadow) {
    findings.push({
      ...base, severity: "warn", property: "box-shadow",
      figmaValue: figma.styles.boxShadow, liveValue: "none", delta: "missing",
      description: "Design has a shadow but live element does not",
    });
  }

  return findings;
}

export function compareSpacing(figma, live, thresholds) {
  const findings = [];
  const tl = thresholds.layout;
  const base = { category: "spacing", figmaNodeId: figma.id, figmaNodeName: figma.name, selector: live.selector };

  const checks = [
    { prop: "padding-top",    figmaVal: figma.styles.paddingTop,    liveVal: live.styles.paddingTop,    t: tl.paddingDeltaPx },
    { prop: "padding-right",  figmaVal: figma.styles.paddingRight,  liveVal: live.styles.paddingRight,  t: tl.paddingDeltaPx },
    { prop: "padding-bottom", figmaVal: figma.styles.paddingBottom, liveVal: live.styles.paddingBottom, t: tl.paddingDeltaPx },
    { prop: "padding-left",   figmaVal: figma.styles.paddingLeft,   liveVal: live.styles.paddingLeft,   t: tl.paddingDeltaPx },
    { prop: "gap",            figmaVal: figma.styles.gap,           liveVal: live.styles.gap,           t: tl.marginDeltaPx },
  ];

  for (const { prop, figmaVal, liveVal, t } of checks) {
    if (figmaVal == null || liveVal == null) continue;
    const delta = liveVal - figmaVal;
    const severity = numSeverity(delta, t);
    if (severity !== "pass") findings.push({
      ...base, severity, property: prop,
      figmaValue: `${figmaVal}px`, liveValue: `${liveVal}px`,
      delta: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}px`,
      description: `${prop} should be ${figmaVal}px but is ${liveVal}px`,
    });
  }

  return findings;
}

export function compareSize(figma, live, thresholds) {
  const findings = [];
  const tl = thresholds.layout;
  const base = { category: "size", figmaNodeId: figma.id, figmaNodeName: figma.name, selector: live.selector };

  for (const [prop, figmaVal, liveVal] of [
    ["width",  figma.bbox.w, live.bbox.w],
    ["height", figma.bbox.h, live.bbox.h],
  ]) {
    if (!figmaVal || !liveVal) continue;
    const delta = liveVal - figmaVal;
    const severity = numSeverity(delta, tl.sizeDeltaPx);
    if (severity !== "pass") findings.push({
      ...base, severity, property: prop,
      figmaValue: `${figmaVal}px`, liveValue: `${liveVal}px`,
      delta: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}px`,
      description: `${prop} should be ${figmaVal}px but is ${liveVal}px`,
    });
  }

  return findings;
}

export function comparePresence(figmaNodes, liveElements) {
  const findings = [];

  // Figma nodes with text that should appear in live
  for (const node of figmaNodes) {
    if (!node.text || node.text.length < 3) continue;
    const found = liveElements.some(
      (el) => el.text && (
        el.text.toLowerCase().includes(node.text.toLowerCase()) ||
        node.text.toLowerCase().includes(el.text.toLowerCase())
      )
    );
    if (!found) {
      findings.push({
        category: "presence",
        severity: "error",
        figmaNodeId: node.id,
        figmaNodeName: node.name,
        selector: null,
        property: "element-presence",
        figmaValue: node.text.slice(0, 60),
        liveValue: "not found",
        delta: "missing",
        description: `"${node.text.slice(0, 60)}" exists in design but not found in live page`,
      });
    }
  }

  return findings;
}

/** Run all Phase 1 comparisons for a matched pair */
export function compareAll(figmaNode, liveElement, thresholds) {
  return [
    ...compareTypography(figmaNode, liveElement, thresholds),
    ...compareColors(figmaNode, liveElement, thresholds),
    ...compareSpacing(figmaNode, liveElement, thresholds),
    ...compareSize(figmaNode, liveElement, thresholds),
  ];
}
