// Calls the OpenAI Chat Completions API with structured outputs so the model
// is forced to return a SiteManifest that already validates against the zod
// schema. Runs in plain Node (reads process.env), NOT inside apps/web/workerd.
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { SiteManifest, normalizeManifest } from "./manifest-schema.js";
import { buildPrompt } from "./prompt.js";
import { callCodexStructured } from "./codex-cli.js";

// A safe default; override with CODEGEN_MODEL to whatever the key supports
// (e.g. gpt-4o, gpt-4o-mini, o4-mini, gpt-5-codex...). Structured outputs
// (response_format json_schema) are required, so pick a model that supports it.
const DEFAULT_MODEL = "gpt-4o";

export async function callLLM({ requirement, attempt, prevBuildError, apiKey, model, specAnchor, proposalAnchor, designAnchor, tasksAnchor, previewAnchor, signal }) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  const messages = buildPrompt({ requirement, attempt, prevBuildError, specAnchor, proposalAnchor, designAnchor, tasksAnchor, previewAnchor });
  const resolvedModel = model || process.env.CODEGEN_MODEL || DEFAULT_MODEL;

  if (!key) {
    const parsed = await callCodexStructured({ schema: SiteManifest, name: "site_manifest", messages, signal });
    return normalizeManifest(parsed);
  }

  const client = new OpenAI({ apiKey: key });

  const result = await client.chat.completions.parse({
    model: resolvedModel,
    messages,
    response_format: zodResponseFormat(SiteManifest, "site_manifest"),
  }, { signal });

  const parsed = result.choices[0]?.message?.parsed;
  if (!parsed) {
    const refusal = result.choices[0]?.message?.refusal;
    throw new Error(
      refusal
        ? `Model refused: ${refusal}`
        : "Model did not return a parseable site_manifest",
    );
  }
  return normalizeManifest(parsed);
}
