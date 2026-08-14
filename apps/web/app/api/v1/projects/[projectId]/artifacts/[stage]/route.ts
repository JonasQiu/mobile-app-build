import { getD1, jsonError, requireSession } from "../../../../../../lib/server-auth";

const STAGES = ["mobile-spec", "implementation", "build", "deployment"];
const RUNNER_TIMEOUT_MS = 12_000;

export async function GET(request: Request, context: RouteContext<"/api/v1/projects/[projectId]/artifacts/[stage]">) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  const { projectId, stage } = await context.params;
  if (!STAGES.includes(stage)) return jsonError("未知执行步骤", 404);

  const project = await getD1().prepare(`SELECT id, prompt FROM projects
    WHERE id = ? AND owner_user_id = ? LIMIT 1`).bind(projectId, user.id).first<{ id: string; prompt: string }>();
  if (!project) return jsonError("项目不存在", 404);

  const endpoint = process.env.CODEX_RUNNER_URL;
  const token = process.env.CODEX_RUNNER_TOKEN;
  if (!endpoint || !token) return jsonError("Codex Runner 当前不可用，无法读取产物", 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNNER_TIMEOUT_MS);
  try {
    const origin = new URL(endpoint).origin;
    const response = await fetch(`${origin}/jobs/${encodeURIComponent(project.id)}/artifacts/${encodeURIComponent(stage)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ requirement: project.prompt }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null) as { error?: string; stage?: string; checkpointed?: boolean; artifacts?: unknown[] } | null;
    if (!response.ok || !data) return jsonError(data?.error || "读取步骤产物失败", response.status || 502);
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? `读取步骤产物失败：${error.message}` : "读取步骤产物失败", 502);
  } finally {
    clearTimeout(timer);
  }
}
