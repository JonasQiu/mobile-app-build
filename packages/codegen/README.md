# @mobile-app-build/codegen

Node codegen engine: **one-sentence requirement → OpenAI → real Next.js project → `npm install` + `next build` → clickable preview URL**.

It runs as a **plain Node process**, separate from `apps/web`. `apps/web` is bundled into workerd even in `npm run dev` (`@cloudflare/vite-plugin` + `@cloudflare/unenv-preset`), which stubs `node:child_process` and the real `node:fs` — so it **cannot** spawn `npm install` / `next build` itself. This package is that missing execution surface, wrapped in a tiny local HTTP runner that stands in for the (not-yet-built) cloud agent.

## Pipeline

**Phase 1 — spec workflow (optional, default on).** `runSpecWorkflow()` authors a *requirement-specific* OpenSpec spec through the real mobile-spec state machine, in an isolated workspace, via the `mobile-spec` bin run as a subprocess:

1. `createSpecWorkspace()` — writes a minimal `openspec/config.yaml` (`schema: h5-sdd`) + the requirement source. `init` is deliberately skipped (the schema resolves via mobile-spec's `__dirname` fallback), avoiding its `process.exit` hazard.
2. For each stage `propose → design → task`: `preStage` → author the stage's artifacts with OpenAI (`spec-llm.js`) → `postNode` per artifact → `postStage` (runs the real gate). On a gate failure the gate message is fed back to the author fn and the stage retries (≤2). Output: `proposal.md` + `specs/<id>/spec.md` + `design.md` + `review.md` + `tasks.md`.
3. The strict gates (`proposal-status:ready` + 未决问题 table, `review-status:pass`, `task-format`) are too fiddly to trust to the model, so the engine appends **deterministic footers** (`finalizeProposalMd` / `finalizeReviewMd`) that are guaranteed to pass — the LLM never writes `status:` lines or the 未决问题 section.

**Phase 2 — code-gen.**

1. `copyTemplate()` — copies `templates/next-web` (excluding `node_modules/.next/.git`) into a work dir.
2. `callLLM()` — Chat Completions `.parse()` with structured outputs, forcing a `SiteManifest` (zod-validated) that lists the files to write.
3. `writeManifest()` — writes each file, rejecting any path that escapes the work dir.
4. `runBuild()` — `npm install` then `next build`; on failure, the log tail is fed back to the model.
5. `generate()` — repeats 2–4 up to **3** times, returning the first green build (or the last failure).
6. `startPreview()` — serves the built app with `next start` on an ephemeral port.

When phase 1 succeeds, the authored `spec.md` (+ `proposal.md` / `design.md`) is the **authoritative anchor** for the code-gen prompt, replacing the static fitness sample. The golden `generated/fitness-web/lib/data.ts` is still embedded as a structural example (it teaches *how* to model data in `lib/data.ts`, independent of topic). On any phase-1 failure the engine **degrades gracefully** to the static fitness anchor and reports `specWorkflowOk:false` + `degradedReason` — code-gen still works; the workflow is a quality enhancer, not a hard prerequisite.

## Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | **Required** for any LLM call. Never read by `apps/web`. |
| `CODEGEN_MODEL` | `gpt-4o` | Model id. Must support structured outputs. Set to whatever your key allows (`gpt-4o`, `gpt-4o-mini`, `o4-mini`, `gpt-5-codex`, …). |
| `CODEGEN_NO_SPEC` | unset | `=1` skips phase 1 entirely (static fitness anchor, original single-call path). |
| `CODEGEN_RUNNER_PORT` | `5174` | Runner HTTP port. |
| `CODEGEN_WEB_ORIGIN` | `http://localhost:5173` | Allowed CORS origin (the `apps/web` dev origin). |
| `CODEGEN_TIMEOUT_MS` | `600000` | Per-generation hard cap (phase 1 + 2 can exceed 5 min). |
| `MOBILE_SPEC_HOME_OVERRIDE` | unset | Per-slug sidecar isolation — **set by the engine**, don't set manually. |
| `MOBILE_SPEC_WORKFLOW_SKIP_MONITOR` | unset | `=1` skips the blocking monitor `spawnSync` in mobile-spec hooks — **load-bearing**; always set by `mobileSpecEnv()`. |
| `MOBILE_SPEC_SKIP_EVAL` | unset | `=1` defensive (only `init` reads it; we skip `init`). Always set by `mobileSpecEnv()`. |

> `packages/mobile-spec`'s own deps (js-yaml etc.) must be installed locally (`packages/mobile-spec` has its own `package.json`).

## CLI

```bash
# Full pipeline: phase 1 (spec workflow) + phase 2 (code-gen). Authored spec
# lands in /tmp/gen.spec/openspec/changes/<change>/ for inspection.
OPENAI_API_KEY=sk-... node bin/generate.mjs "做一个咖啡店官网" --out /tmp/gen
# add --serve to also start a preview, --model to override CODEGEN_MODEL
OPENAI_API_KEY=sk-... node bin/generate.mjs "做一个咖啡店官网" --out /tmp/gen --serve
# skip phase 1 (static fitness anchor — the original single-call path)
OPENAI_API_KEY=sk-... node bin/generate.mjs "做一个咖啡店官网" --out /tmp/gen --no-spec
```

## Local runner (what `apps/web` talks to)

```bash
npm install
OPENAI_API_KEY=sk-... CODEGEN_MODEL=gpt-4o node runner.mjs
# -> http://localhost:5174
```

- `GET /health` → `{ ok, openaiKeyPresent }` (UI preflight).
- `POST /generate { prompt, projectName?, model? }` → on success `{ ok, previewUrl, buildOk, attempts, specWorkflowOk, degradedReason }`; on failure HTTP 500 `{ ok:false, error, buildLog }`. `specWorkflowOk:false` means phase 1 degraded to the static anchor (the build can still succeed).

Work dirs live in `<repo>/.codegen/work/<slug>` (gitignored); spec workspaces in `<repo>/.codegen/spec/<slug>`.

## Tests (no key needed)

```bash
npm install
npm test
```

- `template` / `write` / `manifest-schema`: fast unit tests.
- `spec-finalize`: unit-tests the deterministic gate-passing footers (status line count, 未决问题 table shape, idempotency).
- `spec-workspace`: workspace bootstrap, `runMobileSpec` JSON-parsing on success **and** on a gate failure (non-zero exit), and per-workspace sidecar isolation.
- `spec-workflow-drive`: **keystone** — drives the propose stage through the *real* mobile-spec gates (no key) using the golden fitness artifacts + `finalizeProposalMd`, asserting `checks/propose.json` `ok===true`. Proves the driving loop + deterministic footers satisfy the actual gates.
- `build`: copies `generated/fitness-web` to a temp dir and runs the real `npm install` + `next build` (~1–2 min, needs network). This is the proof that the build phase goes green on a known-good fixture.

## Status & caveats

Dev-only. The localhost preview is not a production deployment — a real cloud runner (see `docs/`) is still future work. The OpenAI SDK is pinned to `^4` with `zod ^3` because that pair's `zodResponseFormat` / `.parse()` path is the most thoroughly battle-tested; bump both together if you need a newer major.
