# Frontend QA Agent

Automated QA testing that compares a Figma design against a live app.

## What It Does

Given a Figma URL, a live app URL, and optionally a PRD PDF, the agent:
1. Extracts all Figma frames as designs-of-truth
2. Logs into the live app (credentials are hardcoded in env)
3. Navigates to the source URL and explores UI states by clicking interactive elements (excluding the left-nav sidebar)
4. Builds a state graph: source → popups → modals → sub-pages
5. Matches each live state to its Figma frame using a 3-signal scoring system (visual + text + structure)
6. Flags visual differences, missing elements, broken interactions, accessibility issues
7. Checks PRD acceptance criteria against live states
8. Generates a shareable HTML report with a quality score

## Project Layout

```
UI_Testing_agent/
├── agent/           # Node.js backend — the actual QA runner
│   ├── agent.mjs    # Main orchestrator
│   └── lib/         # Modules: figma, auth, explorer, matcher, compare, etc.
├── web/             # Next.js UI — form to trigger runs, view reports
├── config/          # Thresholds for scoring
└── .github/workflows/qa-run.yml  # Triggers agent on repository_dispatch
```

## Run Locally

```bash
cd agent
npm install
npx playwright install chromium
node agent.mjs
```

Env vars (see `.env.example`). The agent reads `FIGMA_FILE_URL` and `LIVE_URL` per run.
