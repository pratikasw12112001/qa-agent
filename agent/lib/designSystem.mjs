/**
 * Design System integration module.
 *
 * Exports:
 *   DESIGN_SYSTEM_CHECKS        — all check specs grouped by component key
 *   COMPONENT_DETECTORS         — CSS selectors per component key
 *   detectComponentsOnPage()    — returns Set of present component keys
 *   runDeterministicChecks()    — Playwright-based ARIA / cursor / size checks
 *   getChecksForComponents()    — returns applicable check specs for detected components
 *   buildDesignSystemPromptContext() — builds AI prompt section for design system checks
 */

// ─── Check data ───────────────────────────────────────────────────────────────

export const DESIGN_SYSTEM_CHECKS = {
  global: [
    { id: "GLB-V-01", description: "Colour tokens match Figma styles (light + dark)", expected: "All background/text/border colours match Figma design tokens", type: "V" },
    { id: "GLB-V-02", description: "Typography scale matches Figma", expected: "Font family, size, weight, line-height match Figma text styles", type: "V" },
    { id: "GLB-V-03", description: "Spacing consistent with 4px base token grid", expected: "All spacing values are multiples of 4px", type: "V" },
    { id: "GLB-V-04", description: "Components reflow at mobile 390px, tablet 768px, desktop 1440px", expected: "Layout adapts correctly at each breakpoint without overflow or clipping", type: "V" },
    { id: "GLB-A-01", description: "Every interactive element shows visible focus ring", expected: "Tab key shows outline/ring on buttons, links, inputs — outline is not 'none'", type: "A" },
    { id: "GLB-V-05", description: "Dark mode surfaces/text/borders switch correctly", expected: "Dark mode colours match Figma dark theme tokens", type: "V" },
    { id: "GLB-V-06", description: "Correct CSS cursor per element type", expected: "pointer on clickable, text on inputs, not-allowed on disabled", type: "V" },
    { id: "GLB-V-07", description: "No component clipped/hidden by overflow", expected: "All components fully visible, no unintended overflow:hidden clipping", type: "V" },
  ],

  colour: [
    { id: "COL-V-01", description: "bg/primary token light mode = White #FFFFFF or design token", expected: "#FFFFFF or documented light surface token", type: "V" },
    { id: "COL-V-02", description: "bg/primary token dark mode = near-black surface", expected: "Near-black background colour matching Figma dark surface token", type: "V" },
    { id: "COL-V-03", description: "Primary blue token matches rendered button background", expected: "Primary action button background matches Figma primary blue token", type: "V" },
    { id: "COL-V-04", description: "Semantic colours success/danger/warning/info match Figma tokens", expected: "Success=green, danger=red, warning=amber, info=blue — match Figma semantic tokens", type: "V" },
    { id: "COL-A-01", description: "Body text contrast >= WCAG AA 4.5:1", expected: "Contrast ratio >= 4.5:1 for body text on its background", type: "A" },
    { id: "COL-A-02", description: "Secondary/muted text contrast >= WCAG AA 4.5:1", expected: "Contrast ratio >= 4.5:1 for secondary/caption text", type: "A" },
  ],

  text: [
    { id: "TXT-V-01", description: "Title/page headings font properties match Figma", expected: "Font family, size, weight, letter-spacing, line-height match Figma heading style", type: "V" },
    { id: "TXT-V-02", description: "Body text font size and line-height match Figma", expected: "Body text matches Figma body style (typically 14-16px)", type: "V" },
    { id: "TXT-V-03", description: "Secondary/caption text matches Figma secondary style", expected: "Smaller size, muted colour matching Figma secondary style", type: "V" },
    { id: "TXT-V-04", description: "Header Title (modal/drawer heading) matches Figma Header Title style", expected: "Semi-bold weight, correct size matching Figma Header Title style", type: "V" },
    { id: "TXT-V-05", description: "Page Title — largest text style with font weight 700", expected: "Largest heading is font-weight 700 (bold)", type: "V" },
    { id: "TXT-V-06", description: "No font substitution — correct font family loaded", expected: "Correct font family in use, no system fallback font substitution", type: "V" },
  ],

  button: [
    { id: "BTN-V-01", description: "Primary button bg default = solid primary blue", expected: "Solid primary blue background matching Figma token", type: "V" },
    { id: "BTN-V-02", description: "Primary button hover = slightly darker blue", expected: "Hover background slightly darker than default (Figma hover swatch)", type: "V" },
    { id: "BTN-V-03", description: "Primary button pressed = darkest blue", expected: "Pressed/active background is darkest blue (Figma pressed swatch)", type: "V" },
    { id: "BTN-V-04", description: "Primary button disabled = reduced opacity or muted colour; cursor: not-allowed", expected: "Disabled state has reduced opacity or muted colour; cursor is not-allowed", type: "V" },
    { id: "BTN-V-05", description: "Secondary button border and background match Figma", expected: "White/transparent background with 1px border", type: "V" },
    { id: "BTN-V-06", description: "Ghost button = no border, no background in default state", expected: "Ghost/text button has no visible border and no background", type: "V" },
    { id: "BTN-V-07", description: "Button border-radius matches Figma (6-8px)", expected: "Border-radius is 6-8px matching Figma spec", type: "V" },
    { id: "BTN-V-08", description: "Button internal horizontal padding matches Figma", expected: "Horizontal padding matches Figma button padding spec", type: "V" },
    { id: "BTN-V-09", description: "Icon alignment in buttons — vertically centred, correct gap", expected: "Icons vertically centred relative to label; gap matches Figma", type: "V" },
    { id: "BTN-V-10", description: "Button label typography matches Figma button label style", expected: "Font size and weight match Figma button label style", type: "V" },
    { id: "BTN-B-01", description: "Click triggers correct action", expected: "Button click produces expected result/navigation", type: "B" },
    { id: "BTN-B-02", description: "Hover transition speed ~150-200ms ease", expected: "CSS transition ~150-200ms ease on hover state change", type: "B" },
    { id: "BTN-B-03", description: "Disabled button is non-interactive", expected: "Disabled button does not respond to click, pointer-events:none or disabled attr", type: "B" },
    { id: "BTN-A-01", description: "Tab key focuses button with visible focus ring", expected: "Tab-focus produces visible outline/focus ring on button", type: "A" },
    { id: "BTN-A-02", description: "Enter/Space activates same action as mouse click", expected: "Keyboard Enter or Space key triggers button action", type: "A" },
    { id: "BTN-A-03", description: "Icon-only button has aria-label or title", expected: "Icon-only buttons have non-empty aria-label or title attribute", type: "A" },
  ],

  breadcrumb: [
    { id: "BRD-V-01", description: "Separator character matches Figma", expected: "Separator between breadcrumb items matches Figma design", type: "V" },
    { id: "BRD-V-02", description: "Current page item visually distinct (bold or different colour)", expected: "Last breadcrumb item is bold or different colour from ancestor links", type: "V" },
    { id: "BRD-V-03", description: "Link item colour matches Figma token; underline on hover", expected: "Link colour matches Figma token; text underlines on hover", type: "V" },
    { id: "BRD-V-04", description: "Truncation for long paths (ellipsis if specified)", expected: "Long breadcrumb paths show ellipsis per Figma spec", type: "V" },
    { id: "BRD-B-01", description: "Clicking ancestor link navigates correctly", expected: "Ancestor breadcrumb links navigate to the correct page", type: "B" },
    { id: "BRD-A-01", description: "nav[aria-label='Breadcrumb'] wraps the list", expected: "Breadcrumb nav element has aria-label='Breadcrumb'", type: "A" },
    { id: "BRD-A-02", description: "aria-current='page' on last breadcrumb item", expected: "Last breadcrumb item has aria-current='page'", type: "A" },
  ],

  tabs: [
    { id: "TAB-V-01", description: "Active tab underline colour and thickness matches Figma (~2px)", expected: "Active tab indicator is ~2px thick in correct accent colour", type: "V" },
    { id: "TAB-V-02", description: "Inactive tab text muted colour matching Figma", expected: "Inactive tab labels use muted colour from Figma token", type: "V" },
    { id: "TAB-V-03", description: "Tab spacing/gap matches Figma", expected: "Gap between tab items matches Figma layout", type: "V" },
    { id: "TAB-V-04", description: "Bottom border 1px separating tab bar from content", expected: "1px bottom border below tab bar separates it from panel content", type: "V" },
    { id: "TAB-S-01", description: "Hover state on inactive tab (text brightens or underline)", expected: "Hover on inactive tab brightens text or shows underline", type: "S" },
    { id: "TAB-B-01", description: "Clicking inactive tab switches content; active indicator moves", expected: "Tab click activates panel and moves the active indicator", type: "B" },
    { id: "TAB-B-02", description: "Overflow/scrollable tabs work", expected: "Tab bar scrolls horizontally when tabs overflow container", type: "B" },
    { id: "TAB-A-01", description: "role='tablist', role='tab', role='tabpanel' present", expected: "ARIA tablist/tab/tabpanel roles correctly applied", type: "A" },
    { id: "TAB-A-02", description: "Left/Right arrow key navigation between tabs", expected: "Arrow keys move focus between tabs within the tablist", type: "A" },
  ],

  stepper: [
    { id: "STP-V-01", description: "Step indicator size and shape matches Figma", expected: "Step circle/indicator size and shape match Figma spec", type: "V" },
    { id: "STP-V-02", description: "Completed step styling (filled/checkmark)", expected: "Completed steps show filled background or checkmark icon", type: "V" },
    { id: "STP-V-03", description: "Active step styling (highlighted/bordered)", expected: "Active step is highlighted or has distinct border", type: "V" },
    { id: "STP-V-04", description: "Connector line changes to accent when step completed", expected: "Connector/progress line between steps fills with accent colour on completion", type: "V" },
    { id: "STP-B-01", description: "Increment/decrement controls work", expected: "Step increment/decrement controls change value correctly", type: "B" },
    { id: "STP-B-02", description: "Min/max boundary enforced", expected: "Stepper respects min and max boundaries and disables controls at limits", type: "B" },
  ],

  search: [
    { id: "SRH-V-01", description: "Input border colour default matches Figma border token", expected: "Search input default border colour matches Figma border token", type: "V" },
    { id: "SRH-V-02", description: "Input border focused = primary blue + box-shadow", expected: "Focused search input has primary blue border and box-shadow", type: "V" },
    { id: "SRH-V-03", description: "Search icon leading (left), vertically centred", expected: "Search icon is left-aligned and vertically centred within input", type: "V" },
    { id: "SRH-V-04", description: "Clear/X button appears when input has value", expected: "Clear button appears at trailing edge only when input is non-empty", type: "V" },
    { id: "SRH-V-05", description: "Placeholder text colour and copy matches Figma", expected: "Placeholder text colour and content match Figma design", type: "V" },
    { id: "SRH-V-06", description: "Multi-field tag/chip styling matches Figma tag component", expected: "Tags/chips inside search input match Figma tag component style", type: "V" },
    { id: "SRH-B-01", description: "Typing triggers search (debounced or Enter)", expected: "Typing in search triggers results — either debounced or on Enter", type: "B" },
    { id: "SRH-B-02", description: "Clear button empties input and resets results", expected: "Clear (X) button removes all input content and resets search results", type: "B" },
    { id: "SRH-A-01", description: "Input has aria-label or associated label", expected: "Search input has aria-label or linked <label> element", type: "A" },
  ],

  dropdown: [
    { id: "DRP-V-01", description: "Trigger button matches Figma (dashed border, label, icon)", expected: "Dropdown trigger styling matches Figma (border style, label, chevron icon)", type: "V" },
    { id: "DRP-V-02", description: "Open menu panel shadow and border match Figma elevation", expected: "Open dropdown panel has correct shadow and border per Figma elevation spec", type: "V" },
    { id: "DRP-V-03", description: "Menu item height and padding match Figma", expected: "Each dropdown menu item height and padding match Figma", type: "V" },
    { id: "DRP-V-04", description: "Hover highlight on menu item matches Figma", expected: "Hovered menu item background highlight matches Figma", type: "V" },
    { id: "DRP-V-05", description: "Selected item visual indicator (check icon or highlight)", expected: "Selected/active menu item shows checkmark icon or distinct highlight", type: "V" },
    { id: "DRP-C-01", description: "Menu item labels match Figma copy", expected: "Dropdown option text labels match Figma design copy", type: "C" },
    { id: "DRP-B-01", description: "Clicking trigger opens menu", expected: "Trigger click reveals the dropdown menu panel", type: "B" },
    { id: "DRP-B-02", description: "Clicking outside closes menu", expected: "Clicking outside the menu dismisses it", type: "B" },
    { id: "DRP-B-03", description: "Clicking item selects and closes", expected: "Clicking a menu item selects it and closes the dropdown", type: "B" },
    { id: "DRP-A-01", description: "aria-haspopup='listbox' and aria-expanded toggled correctly", expected: "Trigger has aria-haspopup='listbox'; aria-expanded toggles true/false on open/close", type: "A" },
    { id: "DRP-A-02", description: "Escape closes menu; focus returns to trigger", expected: "Escape key closes dropdown and returns focus to the trigger element", type: "A" },
    { id: "DRP-A-03", description: "Arrow keys navigate items", expected: "Up/Down arrow keys move focus between menu items", type: "A" },
  ],

  checkbox: [
    { id: "CHK-V-01", description: "Unchecked box size and border matches Figma", expected: "Unchecked checkbox size and border colour/width match Figma", type: "V" },
    { id: "CHK-V-02", description: "Checked box filled with primary blue; white checkmark centred", expected: "Checked state has primary blue fill with centred white checkmark", type: "V" },
    { id: "CHK-V-03", description: "Indeterminate state visual (horizontal dash)", expected: "Indeterminate checkbox shows horizontal dash indicator", type: "V" },
    { id: "CHK-V-04", description: "Label vertically aligned to checkbox; gap matches Figma", expected: "Label is vertically centred relative to checkbox; gap matches Figma", type: "V" },
    { id: "CHK-V-05", description: "Disabled state reduced opacity; non-interactive cursor", expected: "Disabled checkbox has reduced opacity and not-allowed cursor", type: "V" },
    { id: "CHK-B-01", description: "Clicking label or box toggles state", expected: "Click on either checkbox or label toggles checked state", type: "B" },
    { id: "CHK-A-01", description: "Space key toggles checkbox", expected: "Space key toggles checkbox checked state when focused", type: "A" },
    { id: "CHK-A-02", description: "aria-checked='mixed' on indeterminate", expected: "Indeterminate checkbox has aria-checked='mixed'", type: "A" },
  ],

  radio: [
    { id: "RAD-V-01", description: "Unselected radio circle size and border match Figma", expected: "Unselected radio circle matches Figma size and border spec", type: "V" },
    { id: "RAD-V-02", description: "Selected radio inner dot in primary blue", expected: "Selected radio has primary blue inner dot", type: "V" },
    { id: "RAD-V-03", description: "Loading/spinner state matches Figma", expected: "Loading spinner inside/near radio matches Figma spec", type: "V" },
    { id: "RAD-V-04", description: "Disabled radio muted colour; non-interactive", expected: "Disabled radio has muted colour and is non-interactive", type: "V" },
    { id: "RAD-B-01", description: "Selecting one radio deselects others in group", expected: "Only one radio in a group can be selected at a time", type: "B" },
    { id: "RAD-A-01", description: "role='radiogroup' wraps related radios", expected: "Related radio inputs are wrapped in element with role='radiogroup'", type: "A" },
  ],

  toggle: [
    { id: "TOG-V-01", description: "Off state track colour = muted grey matching Figma off token", expected: "Toggle track in off state is muted grey per Figma off token", type: "V" },
    { id: "TOG-V-02", description: "On state track colour = primary blue or success green", expected: "Toggle track in on state is primary blue or success green per Figma", type: "V" },
    { id: "TOG-V-03", description: "Thumb colour white; diameter and position match Figma", expected: "Toggle thumb is white; diameter and position (offset) match Figma", type: "V" },
    { id: "TOG-V-04", description: "Track width and height match Figma toggle dimensions", expected: "Toggle track width and height match Figma dimensions", type: "V" },
    { id: "TOG-V-05", description: "Disabled state reduced opacity; non-interactive cursor", expected: "Disabled toggle has reduced opacity and not-allowed cursor", type: "V" },
    { id: "TOG-B-01", description: "Click toggles on/off with 150-200ms animation", expected: "Toggle click switches state with 150-200ms CSS transition", type: "B" },
    { id: "TOG-A-01", description: "role='switch'; aria-checked updates on toggle", expected: "Toggle has role='switch'; aria-checked is 'true'/'false' and updates on click", type: "A" },
  ],

  banner: [
    { id: "BAN-V-01", description: "Marketing banner bg matches Figma (dark or brand colour)", expected: "Marketing banner background matches Figma brand/dark colour", type: "V" },
    { id: "BAN-V-02", description: "CTA button variant, colour, label match Figma", expected: "Banner CTA button style and label matches Figma design", type: "V" },
    { id: "BAN-V-03", description: "Alert banner bg = red/danger matching Figma danger token", expected: "Alert banner background is red/danger matching Figma danger token", type: "V" },
    { id: "BAN-V-04", description: "Alert banner icon present; correct size and colour", expected: "Alert icon present at correct size and colour per Figma", type: "V" },
    { id: "BAN-V-05", description: "Dismiss (x) button right-aligned, vertically centred", expected: "Dismiss button is right-aligned and vertically centred in banner", type: "V" },
    { id: "BAN-C-01", description: "Banner message text matches Figma copy", expected: "Banner message copy matches Figma text content", type: "C" },
    { id: "BAN-B-01", description: "Dismiss button removes banner; no layout jump", expected: "Clicking dismiss removes the banner smoothly without layout jump", type: "B" },
    { id: "BAN-A-01", description: "role='alert' or role='status' present", expected: "Banner element has role='alert' (urgent) or role='status' (informational)", type: "A" },
  ],

  iconButton: [
    { id: "ICB-V-01", description: "Container >= 32x32px touch target; matches Figma size", expected: "Icon button container is at least 32×32px meeting touch target minimum", type: "V" },
    { id: "ICB-V-02", description: "Icon 16-20px; visually centred within button", expected: "Icon is 16-20px and centred both horizontally and vertically", type: "V" },
    { id: "ICB-V-03", description: "Border-radius matches Figma icon button shape variant", expected: "Border-radius matches Figma spec (square, rounded, or circular)", type: "V" },
    { id: "ICB-V-04", description: "Hover state shows subtle background fill", expected: "Hover reveals subtle background fill per Figma hover token", type: "V" },
    { id: "ICB-A-01", description: "aria-label describes the action; not empty", expected: "Icon-only button has non-empty aria-label describing its action", type: "A" },
  ],

  card: [
    { id: "CRD-V-01", description: "Card background white, 1px border, border-radius matches Figma", expected: "Card has white background, 1px border, and border-radius per Figma", type: "V" },
    { id: "CRD-V-02", description: "Card icon container blue matching Figma token", expected: "Icon container background is blue matching Figma colour token", type: "V" },
    { id: "CRD-V-03", description: "Active/selected card has left border or full border in primary blue", expected: "Selected card shows left accent border or full primary blue border", type: "V" },
    { id: "CRD-V-04", description: "Card padding and gaps match Figma", expected: "Internal card padding and element gaps match Figma layout", type: "V" },
    { id: "CRD-C-01", description: "Title and description text match Figma labels", expected: "Card title and description copy match Figma text content", type: "C" },
    { id: "CRD-B-01", description: "Clicking card selects it; previous deactivates", expected: "Card click selects it and deselects previously selected card", type: "B" },
    { id: "CRD-V-05", description: "Card hover shadow/border intensifies", expected: "Card hover state shows stronger shadow or border intensity per Figma", type: "V" },
  ],

  userCount: [
    { id: "UCT-V-01", description: "Avatar/counter pill size and shape match Figma", expected: "User count avatar/pill size and shape match Figma spec", type: "V" },
    { id: "UCT-V-02", description: "Counter number typography matches Figma", expected: "Counter number font size and weight match Figma text style", type: "V" },
    { id: "UCT-C-01", description: "Correct count displayed", expected: "Displayed user count matches actual data", type: "C" },
    { id: "UCT-B-01", description: "Increment/decrement controls work within bounds", expected: "Controls change count correctly and respect min/max bounds", type: "B" },
  ],
};

// ─── Design token store ───────────────────────────────────────────────────────
// Set by agent.mjs after fetching from Figma. Used by deterministic checks
// to compare against real token values instead of hardcoded ranges.

let _designTokens = null;

/** Called by agent.mjs after fetchDesignTokens() succeeds. */
export function setDesignTokens(tokens) {
  _designTokens = tokens;
  console.log("   Design tokens loaded into designSystem.mjs");
}

/** Returns the current design tokens, or null if not yet loaded. */
export function getDesignTokens() { return _designTokens; }

// ─── Component detectors — CSS selectors per component key ────────────────────

export const COMPONENT_DETECTORS = {
  global:     ["body"],  // always present
  colour:     ["body"],  // always present
  text:       ["h1", "h2", "h3", "p"],
  button:     ["button", ".ant-btn", "[role='button']"],
  breadcrumb: ["nav[aria-label]", ".ant-breadcrumb", "[class*='breadcrumb' i]"],
  tabs:       ["[role='tablist']", ".ant-tabs", ".ant-tabs-nav"],
  stepper:    [".ant-steps", "[class*='stepper' i]", "[class*='step-indicator' i]"],
  search:     ["input[type='search']", ".ant-input-search", "[class*='search-bar' i]", "[class*='searchbar' i]"],
  dropdown:   ["[role='listbox']", ".ant-select", ".ant-dropdown", ".ant-select-dropdown", "[aria-haspopup='listbox']"],
  checkbox:   ["input[type='checkbox']", ".ant-checkbox", "[role='checkbox']"],
  radio:      ["input[type='radio']", ".ant-radio", "[role='radio']", "[role='radiogroup']"],
  toggle:     ["[role='switch']", ".ant-switch", "[class*='toggle' i]"],
  banner:     ["[role='alert']", "[role='status']", ".ant-alert", "[class*='banner' i]", "[class*='alert' i]"],
  iconButton: [".ant-btn-icon-only", "button[aria-label]", "[class*='icon-btn' i]", "[class*='icon-button' i]"],
  card:       [".ant-card", "[class*='config-card' i]", "[class*='card' i]"],
  userCount:  ["[class*='user-count' i]", "[class*='avatar-count' i]", ".ant-avatar-group"],
};

// ─── Detect which components are present on the page ─────────────────────────

/**
 * Evaluates COMPONENT_DETECTORS selectors in the browser context.
 * Returns a Set of component keys that are present on the page.
 */
export async function detectComponentsOnPage(page) {
  const present = new Set(["global", "colour", "text"]);  // always included

  try {
    const detectorEntries = Object.entries(COMPONENT_DETECTORS).filter(
      ([key]) => !["global", "colour", "text"].includes(key)
    );

    const results = await page.evaluate((detectors) => {
      const found = [];
      for (const [key, selectors] of detectors) {
        for (const sel of selectors) {
          try {
            if (document.querySelector(sel)) {
              found.push(key);
              break;
            }
          } catch { /* invalid selector — skip */ }
        }
      }
      return found;
    }, detectorEntries);

    for (const key of results) present.add(key);
  } catch { /* best-effort — return defaults */ }

  return present;
}

// ─── Deterministic Playwright checks ─────────────────────────────────────────

/**
 * Runs non-visual checks deterministically using Playwright.
 * Returns array of { id, result: "PASS"|"FAIL"|"SKIP", notes }.
 */
export async function runDeterministicChecks(page, presentComponents) {
  const results = [];

  // ── GLB-A-01: Focus ring check ─────────────────────────────────────────────
  try {
    const focusResult = await page.evaluate(async () => {
      const interactives = Array.from(
        document.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), [role='button']:not([disabled])")
      ).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 8 && r.height > 8 && r.top >= 0 && r.top < window.innerHeight;
      });

      if (!interactives.length) return { result: "SKIP", notes: "No interactive elements found in viewport" };

      // Check computed styles for focus-visible / outline on first few elements
      let hasRing = false;
      for (const el of interactives.slice(0, 5)) {
        const cs = window.getComputedStyle(el, ":focus");
        const outline = cs.outlineStyle;
        const outlineWidth = parseFloat(cs.outlineWidth || "0");
        const boxShadow = cs.boxShadow;
        if (outline !== "none" && outlineWidth > 0) { hasRing = true; break; }
        if (boxShadow && boxShadow !== "none" && !boxShadow.includes("0px 0px 0px")) { hasRing = true; break; }
      }
      // Fallback: check :focus-visible rule in stylesheets
      if (!hasRing) {
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            for (const rule of Array.from(sheet.cssRules || [])) {
              if (rule.selectorText?.includes(":focus") && rule.style?.outline !== "none") {
                hasRing = true;
                break;
              }
            }
          } catch { /* cross-origin sheet — skip */ }
          if (hasRing) break;
        }
      }
      return hasRing
        ? { result: "PASS", notes: "Focus ring styles detected in computed styles or stylesheets" }
        : { result: "FAIL", notes: "No visible focus ring found on interactive elements; outline may be 'none'" };
    });
    results.push({ id: "GLB-A-01", ...focusResult });
  } catch (e) {
    results.push({ id: "GLB-A-01", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
  }

  // ── GLB-V-06: Cursor checks ────────────────────────────────────────────────
  if (presentComponents.has("button")) {
    try {
      const cursorResult = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button:not([disabled]), .ant-btn:not(.ant-btn-disabled), [role='button']:not([disabled])"))
          .filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 8 && r.height > 8;
          })
          .slice(0, 10);

        if (!buttons.length) return { result: "SKIP", notes: "No visible buttons found" };

        const wrongs = [];
        for (const btn of buttons) {
          const cursor = window.getComputedStyle(btn).cursor;
          if (cursor !== "pointer") {
            const label = (btn.innerText || btn.getAttribute("aria-label") || btn.tagName).slice(0, 30);
            wrongs.push(`"${label}" has cursor:${cursor}`);
          }
        }

        const disabledBtns = Array.from(document.querySelectorAll("button[disabled], .ant-btn-disabled, [aria-disabled='true']"))
          .filter(el => { const r = el.getBoundingClientRect(); return r.width > 8; })
          .slice(0, 5);
        const disabledWrongs = [];
        for (const btn of disabledBtns) {
          const cursor = window.getComputedStyle(btn).cursor;
          if (cursor !== "not-allowed" && cursor !== "default") {
            const label = (btn.innerText || btn.getAttribute("aria-label") || "").slice(0, 30);
            disabledWrongs.push(`disabled "${label}" has cursor:${cursor} (expected not-allowed)`);
          }
        }

        const allWrongs = [...wrongs.slice(0, 3), ...disabledWrongs.slice(0, 2)];
        return allWrongs.length
          ? { result: "FAIL", notes: allWrongs.join("; ") }
          : { result: "PASS", notes: `All ${buttons.length} checked button(s) have correct cursor` };
      });
      results.push({ id: "GLB-V-06", ...cursorResult });
    } catch (e) {
      results.push({ id: "GLB-V-06", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── BTN-B-03: Disabled button is non-interactive ───────────────────────────
  if (presentComponents.has("button")) {
    try {
      const disabledResult = await page.evaluate(() => {
        const disabled = Array.from(document.querySelectorAll(
          "button[disabled], .ant-btn[disabled], .ant-btn-disabled, [aria-disabled='true']"
        )).filter(el => { const r = el.getBoundingClientRect(); return r.width > 8; });

        if (!disabled.length) return { result: "SKIP", notes: "No disabled buttons found on page" };

        const interactive = [];
        for (const btn of disabled.slice(0, 5)) {
          const pe = window.getComputedStyle(btn).pointerEvents;
          const isDisabledAttr = btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled") === "true";
          if (pe !== "none" && !isDisabledAttr) {
            interactive.push((btn.innerText || btn.getAttribute("aria-label") || "").slice(0, 30));
          }
        }
        return interactive.length
          ? { result: "FAIL", notes: `Possibly interactive disabled buttons: ${interactive.join(", ")}` }
          : { result: "PASS", notes: `${disabled.length} disabled button(s) are non-interactive` };
      });
      results.push({ id: "BTN-B-03", ...disabledResult });
    } catch (e) {
      results.push({ id: "BTN-B-03", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── BTN-A-03: Icon-only button has aria-label ──────────────────────────────
  if (presentComponents.has("button") || presentComponents.has("iconButton")) {
    try {
      const ariaResult = await page.evaluate(() => {
        const iconBtns = Array.from(document.querySelectorAll(
          ".ant-btn-icon-only, button[aria-label], [role='button'][aria-label]"
        )).filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 8 && r.height > 8;
        });

        // Also find buttons that appear to be icon-only (small, no visible text)
        const allBtns = Array.from(document.querySelectorAll("button:not([disabled])"))
          .filter(el => {
            const r = el.getBoundingClientRect();
            const text = (el.innerText || "").trim();
            return r.width >= 24 && r.width <= 56 && r.height >= 24 && r.height <= 56 && !text;
          });

        const missing = [];
        for (const btn of [...iconBtns, ...allBtns].slice(0, 10)) {
          const label = btn.getAttribute("aria-label") || btn.getAttribute("title") || "";
          if (!label.trim()) {
            const cls = (typeof btn.className === "string" ? btn.className : "").slice(0, 40);
            missing.push(cls || btn.tagName.toLowerCase());
          }
        }

        return missing.length
          ? { result: "FAIL", notes: `Icon-only buttons without aria-label: ${missing.slice(0, 3).join(", ")}` }
          : { result: "PASS", notes: "All checked icon-only buttons have aria-label or title" };
      });
      results.push({ id: "BTN-A-03", ...ariaResult });
    } catch (e) {
      results.push({ id: "BTN-A-03", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── ICB-V-01: Icon button touch target >= 32x32px ─────────────────────────
  if (presentComponents.has("iconButton")) {
    try {
      const sizeResult = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll(
          ".ant-btn-icon-only, [class*='icon-btn' i], [class*='icon-button' i]"
        )).filter(el => { const r = el.getBoundingClientRect(); return r.width > 4; });

        if (!btns.length) return { result: "SKIP", notes: "No icon button elements found" };

        const tooSmall = [];
        for (const btn of btns.slice(0, 10)) {
          const r = btn.getBoundingClientRect();
          if (r.width < 32 || r.height < 32) {
            const label = btn.getAttribute("aria-label") || (typeof btn.className === "string" ? btn.className : "").slice(0, 30);
            tooSmall.push(`${label || "btn"} (${Math.round(r.width)}×${Math.round(r.height)}px)`);
          }
        }
        return tooSmall.length
          ? { result: "FAIL", notes: `Icon buttons below 32×32px touch target: ${tooSmall.slice(0, 3).join(", ")}` }
          : { result: "PASS", notes: `All ${btns.length} icon button(s) meet >= 32×32px touch target` };
      });
      results.push({ id: "ICB-V-01", ...sizeResult });
    } catch (e) {
      results.push({ id: "ICB-V-01", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── ICB-A-01: Icon button aria-label ──────────────────────────────────────
  if (presentComponents.has("iconButton")) {
    try {
      const icbAriaResult = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll(
          ".ant-btn-icon-only, [class*='icon-btn' i], [class*='icon-button' i]"
        )).filter(el => { const r = el.getBoundingClientRect(); return r.width > 4; });

        if (!btns.length) return { result: "SKIP", notes: "No icon button elements found" };

        const missing = btns.slice(0, 10).filter(btn => {
          const label = btn.getAttribute("aria-label") || btn.getAttribute("title") || "";
          return !label.trim();
        });

        return missing.length
          ? { result: "FAIL", notes: `${missing.length}/${btns.length} icon button(s) missing aria-label` }
          : { result: "PASS", notes: `All ${btns.length} icon button(s) have aria-label or title` };
      });
      results.push({ id: "ICB-A-01", ...icbAriaResult });
    } catch (e) {
      results.push({ id: "ICB-A-01", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── TAB-A-01: ARIA tab roles ───────────────────────────────────────────────
  if (presentComponents.has("tabs")) {
    try {
      const tabAriaResult = await page.evaluate(() => {
        const tablist = document.querySelector("[role='tablist']");
        if (!tablist) return { result: "FAIL", notes: "No element with role='tablist' found" };

        const tabs = tablist.querySelectorAll("[role='tab']");
        if (!tabs.length) return { result: "FAIL", notes: "role='tablist' found but no role='tab' children" };

        const panels = document.querySelectorAll("[role='tabpanel']");
        if (!panels.length) return { result: "FAIL", notes: "role='tablist' and role='tab' found but no role='tabpanel'" };

        return { result: "PASS", notes: `tablist with ${tabs.length} tab(s) and ${panels.length} panel(s) found` };
      });
      results.push({ id: "TAB-A-01", ...tabAriaResult });
    } catch (e) {
      results.push({ id: "TAB-A-01", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── BRD-A-01: Breadcrumb nav aria-label ───────────────────────────────────
  if (presentComponents.has("breadcrumb")) {
    try {
      const brdAriaResult = await page.evaluate(() => {
        const navs = Array.from(document.querySelectorAll("nav[aria-label]"));
        const breadcrumbNav = navs.find(n =>
          (n.getAttribute("aria-label") || "").toLowerCase().includes("breadcrumb")
        );
        if (breadcrumbNav) {
          const lastItem = breadcrumbNav.querySelector("[aria-current='page']");
          return lastItem
            ? { result: "PASS", notes: "nav[aria-label='Breadcrumb'] found with aria-current='page' on last item" }
            : { result: "FAIL", notes: "nav[aria-label='Breadcrumb'] found but no aria-current='page' on last item" };
        }
        return { result: "FAIL", notes: "No nav[aria-label] with value containing 'breadcrumb' found" };
      });
      results.push({ id: "BRD-A-01", ...brdAriaResult });
      // BRD-A-02 result is included in the BRD-A-01 notes above
    } catch (e) {
      results.push({ id: "BRD-A-01", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── DRP-A-01: aria-haspopup and aria-expanded ─────────────────────────────
  if (presentComponents.has("dropdown")) {
    try {
      const drpAriaResult = await page.evaluate(() => {
        const triggers = Array.from(document.querySelectorAll(
          "[aria-haspopup='listbox'], [aria-haspopup='true'], .ant-select-selector, .ant-dropdown-trigger"
        )).filter(el => { const r = el.getBoundingClientRect(); return r.width > 8; });

        if (!triggers.length) return { result: "SKIP", notes: "No dropdown trigger elements found" };

        const noExpanded = triggers.filter(el => !el.hasAttribute("aria-expanded")).slice(0, 3);
        return noExpanded.length
          ? { result: "FAIL", notes: `${noExpanded.length} dropdown trigger(s) missing aria-expanded attribute` }
          : { result: "PASS", notes: `${triggers.length} dropdown trigger(s) have aria-haspopup and aria-expanded` };
      });
      results.push({ id: "DRP-A-01", ...drpAriaResult });
    } catch (e) {
      results.push({ id: "DRP-A-01", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── CHK-A-02: aria-checked='mixed' on indeterminate ───────────────────────
  if (presentComponents.has("checkbox")) {
    try {
      const indetermResult = await page.evaluate(() => {
        const indeterminate = Array.from(document.querySelectorAll("input[type='checkbox']"))
          .filter(el => el.indeterminate);
        if (!indeterminate.length) return { result: "SKIP", notes: "No indeterminate checkboxes found" };

        const missing = indeterminate.filter(el => el.getAttribute("aria-checked") !== "mixed");
        return missing.length
          ? { result: "FAIL", notes: `${missing.length} indeterminate checkbox(es) missing aria-checked='mixed'` }
          : { result: "PASS", notes: "All indeterminate checkboxes have aria-checked='mixed'" };
      });
      results.push({ id: "CHK-A-02", ...indetermResult });
    } catch (e) {
      results.push({ id: "CHK-A-02", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── TOG-A-01: role='switch' and aria-checked ──────────────────────────────
  if (presentComponents.has("toggle")) {
    try {
      const togAriaResult = await page.evaluate(() => {
        const switches = Array.from(document.querySelectorAll("[role='switch'], .ant-switch"))
          .filter(el => { const r = el.getBoundingClientRect(); return r.width > 8; });

        if (!switches.length) return { result: "SKIP", notes: "No toggle/switch elements found" };

        const issues = [];
        for (const sw of switches.slice(0, 5)) {
          if (sw.getAttribute("role") !== "switch") issues.push("missing role='switch'");
          const checked = sw.getAttribute("aria-checked");
          if (checked !== "true" && checked !== "false") issues.push("aria-checked not 'true'/'false'");
        }
        return issues.length
          ? { result: "FAIL", notes: issues.slice(0, 3).join("; ") }
          : { result: "PASS", notes: `${switches.length} switch(es) have correct role and aria-checked` };
      });
      results.push({ id: "TOG-A-01", ...togAriaResult });
    } catch (e) {
      results.push({ id: "TOG-A-01", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── BAN-A-01: role='alert' or role='status' ────────────────────────────────
  if (presentComponents.has("banner")) {
    try {
      const banAriaResult = await page.evaluate(() => {
        const alerts  = document.querySelectorAll("[role='alert']");
        const statuses = document.querySelectorAll("[role='status']");
        const total = alerts.length + statuses.length;
        if (!total) {
          // Check if there are visible banner-like elements without the role
          const banners = document.querySelectorAll(".ant-alert, [class*='banner' i], [class*='alert' i]");
          if (!banners.length) return { result: "SKIP", notes: "No banner/alert elements found on page" };
          return { result: "FAIL", notes: `${banners.length} banner-like element(s) found but none have role='alert' or role='status'` };
        }
        return { result: "PASS", notes: `${alerts.length} role='alert', ${statuses.length} role='status' element(s) found` };
      });
      results.push({ id: "BAN-A-01", ...banAriaResult });
    } catch (e) {
      results.push({ id: "BAN-A-01", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── RAD-A-01: role='radiogroup' ───────────────────────────────────────────
  if (presentComponents.has("radio")) {
    try {
      const radAriaResult = await page.evaluate(() => {
        const radios = document.querySelectorAll("input[type='radio']");
        if (!radios.length) return { result: "SKIP", notes: "No radio inputs found" };

        const groups = document.querySelectorAll("[role='radiogroup']");
        return groups.length
          ? { result: "PASS", notes: `${groups.length} radiogroup(s) found wrapping ${radios.length} radio input(s)` }
          : { result: "FAIL", notes: `${radios.length} radio input(s) found but no role='radiogroup' wrapper` };
      });
      results.push({ id: "RAD-A-01", ...radAriaResult });
    } catch (e) {
      results.push({ id: "RAD-A-01", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── SRH-A-01: Search input has aria-label or label ───────────────────────
  if (presentComponents.has("search")) {
    try {
      const srchAriaResult = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll(
          "input[type='search'], .ant-input-search input, [class*='search' i] input"
        )).filter(el => { const r = el.getBoundingClientRect(); return r.width > 40; });

        if (!inputs.length) return { result: "SKIP", notes: "No search inputs found" };

        const missing = inputs.filter(el => {
          const label = el.getAttribute("aria-label") || "";
          const id = el.id;
          const linkedLabel = id ? document.querySelector(`label[for='${id}']`) : null;
          const wrappingLabel = el.closest("label");
          return !label.trim() && !linkedLabel && !wrappingLabel;
        });

        return missing.length
          ? { result: "FAIL", notes: `${missing.length}/${inputs.length} search input(s) missing aria-label or associated label` }
          : { result: "PASS", notes: `All ${inputs.length} search input(s) have aria-label or label` };
      });
      results.push({ id: "SRH-A-01", ...srchAriaResult });
    } catch (e) {
      results.push({ id: "SRH-A-01", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  // ── Token-based checks (only when real Figma values are available) ──────────
  const tokens = getDesignTokens();
  if (tokens && presentComponents.has("button")) {

    // BTN-V-07: Border radius matches Figma token value
    if (tokens.borderRadius?.button != null) {
      const expectedRadius = tokens.borderRadius.button;
      try {
        const radiusResult = await page.evaluate((expected) => {
          const btns = Array.from(document.querySelectorAll("button.ant-btn-primary, .ant-btn-primary"))
            .filter(el => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 20; })
            .slice(0, 5);
          if (!btns.length) return { result: "SKIP", notes: "No primary buttons found for radius check" };
          const wrong = [];
          for (const btn of btns) {
            const live = parseFloat(window.getComputedStyle(btn).borderRadius);
            if (!isNaN(live) && Math.abs(live - expected) > 2) {
              const label = (btn.innerText || "").trim().slice(0, 20);
              wrong.push(`"${label}": ${live}px live vs ${expected}px Figma`);
            }
          }
          return wrong.length
            ? { result: "FAIL", notes: wrong.join("; ") }
            : { result: "PASS", notes: `Button border-radius ${expected}px matches Figma token` };
        }, expectedRadius);
        results.push({ id: "BTN-V-07", ...radiusResult });
      } catch (e) {
        results.push({ id: "BTN-V-07", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
      }
    }

    // BTN-V-10: Button label font size/weight match Figma token
    if (tokens.typography?.buttonValues) {
      const { fontSize, fontWeight } = tokens.typography.buttonValues;
      try {
        const typoResult = await page.evaluate(({ fontSize, fontWeight }) => {
          const btns = Array.from(document.querySelectorAll(".ant-btn-primary, button[type='submit']"))
            .filter(el => { const r = el.getBoundingClientRect(); return r.width > 40; })
            .slice(0, 3);
          if (!btns.length) return { result: "SKIP", notes: "No primary buttons found for typography check" };
          const issues = [];
          for (const btn of btns) {
            const cs = window.getComputedStyle(btn);
            const liveSz = parseFloat(cs.fontSize);
            const liveWt = cs.fontWeight;
            const label = (btn.innerText || "").trim().slice(0, 20);
            if (fontSize && !isNaN(liveSz) && Math.abs(liveSz - fontSize) > 1)
              issues.push(`"${label}" font-size: ${liveSz}px live vs ${fontSize}px Figma`);
            if (fontWeight && String(liveWt) !== String(fontWeight))
              issues.push(`"${label}" font-weight: ${liveWt} live vs ${fontWeight} Figma`);
          }
          return issues.length
            ? { result: "FAIL", notes: issues.join("; ") }
            : { result: "PASS", notes: `Button typography matches Figma token (${fontSize}px / ${fontWeight})` };
        }, { fontSize, fontWeight });
        results.push({ id: "BTN-V-10", ...typoResult });
      } catch (e) {
        results.push({ id: "BTN-V-10", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
      }
    }
  }

  // TXT-V-01: Heading font properties match Figma token
  if (tokens?.typography?.headingValues && presentComponents.has("text")) {
    const { fontSize, fontWeight } = tokens.typography.headingValues;
    try {
      const headingResult = await page.evaluate(({ fontSize, fontWeight }) => {
        const h = document.querySelector("h1, h2, .ant-page-header-heading-title");
        if (!h) return { result: "SKIP", notes: "No heading element found" };
        const cs = window.getComputedStyle(h);
        const liveSz = parseFloat(cs.fontSize);
        const liveWt = cs.fontWeight;
        const issues = [];
        if (fontSize && !isNaN(liveSz) && Math.abs(liveSz - fontSize) > 2)
          issues.push(`font-size: ${liveSz}px live vs ${fontSize}px Figma`);
        if (fontWeight && String(liveWt) !== String(fontWeight))
          issues.push(`font-weight: ${liveWt} live vs ${fontWeight} Figma`);
        return issues.length
          ? { result: "FAIL", notes: issues.join("; ") }
          : { result: "PASS", notes: `Heading typography matches Figma token (${fontSize}px / ${fontWeight})` };
      }, { fontSize, fontWeight });
      results.push({ id: "TXT-V-01", ...headingResult });
    } catch (e) {
      results.push({ id: "TXT-V-01", result: "SKIP", notes: `Check error: ${e.message?.slice(0, 80)}` });
    }
  }

  return results;
}

// ─── Get checks for detected components ──────────────────────────────────────

/**
 * Returns an array of check specs applicable to the detected components.
 * Always includes GLB checks.
 */
export function getChecksForComponents(components) {
  const checks = [];
  const componentSet = components instanceof Set ? components : new Set(components);

  // Always include global checks
  checks.push(...(DESIGN_SYSTEM_CHECKS.global ?? []));

  // Map component keys to check groups
  const keyMap = {
    colour:     "colour",
    text:       "text",
    button:     "button",
    breadcrumb: "breadcrumb",
    tabs:       "tabs",
    stepper:    "stepper",
    search:     "search",
    dropdown:   "dropdown",
    checkbox:   "checkbox",
    radio:      "radio",
    toggle:     "toggle",
    banner:     "banner",
    iconButton: "iconButton",
    card:       "card",
    userCount:  "userCount",
  };

  for (const [compKey, checkGroup] of Object.entries(keyMap)) {
    if (componentSet.has(compKey) && DESIGN_SYSTEM_CHECKS[checkGroup]) {
      checks.push(...DESIGN_SYSTEM_CHECKS[checkGroup]);
    }
  }

  return checks;
}

// ─── Build AI prompt context ──────────────────────────────────────────────────

/**
 * Returns a string section to inject into the AI vision prompt.
 * Lists up to 15 relevant check IDs with descriptions and expected values.
 */
export function buildDesignSystemPromptContext(checks) {
  if (!checks || !checks.length) return "";

  // Prioritise visual (V) and content (C) checks for vision model; limit to 15
  const prioritised = [
    ...checks.filter(c => c.type === "V"),
    ...checks.filter(c => c.type === "C"),
    ...checks.filter(c => c.type === "S"),
    ...checks.filter(c => c.type === "B" || c.type === "A"),
  ].slice(0, 15);

  return [
    "",
    "DESIGN SYSTEM CHECKS — evaluate these specific checks and add results to the response:",
    "For each check below, determine: PASS (clearly matches expected), FAIL (clearly deviates), or SKIP (component not visible/applicable).",
    prioritised.map(c => `${c.id}: ${c.description} — Expected: ${c.expected}`).join("\n"),
    "",
    'Add to your JSON response: "dsChecks": [{"id": "...", "result": "PASS|FAIL|SKIP", "notes": "short reason"}]',
  ].join("\n");
}
