import { getD1, jsonError, requireSession } from "../../../../../lib/server-auth";
import { resolveRunnerEndpoint, runnerUrls } from "../../../../../lib/runner-endpoint";

type ProjectRow = { id: string; status: string };

const RUNNER_REQUEST_TIMEOUT_MS = 10_000;
const MAX_ACTIVE_PROJECTS = 2;

async function executionCapacity(userId: string) {
  const capacity = await getD1().prepare(`SELECT COUNT(*) AS active FROM projects
    WHERE owner_user_id = ? AND status IN ('dispatching', 'building')`).bind(userId).first<{ active: number }>();
  return { active: Number(capacity?.active) || 0, max: MAX_ACTIVE_PROJECTS };
}

export async function POST(request: Request, context: RouteContext<"/api/v1/projects/[projectId]/pause">) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  const { projectId } = await context.params;
  const project = await getD1().prepare(`SELECT id, status FROM projects
    WHERE id = ? AND owner_user_id = ? LIMIT 1`).bind(projectId, user.id).first<ProjectRow>();
  if (!project) return jsonError("项目不存在", 404);
  if (project.status === "paused") {
    return Response.json({
      project: { id: project.id, status: "paused", currentStage: "paused" },
      executionCapacity: await executionCapacity(user.id),
    }, {
      status: 202,
      headers: { "cache-control": "no-store" },
    });
  }
  if (!["dispatching", "building"].includes(project.status)) return jsonError("当前任务不在执行中", 409);

  const token = process.env.CODEX_RUNNER_TOKEN;
  const endpoint = await resolveRunnerEndpoint();
  const urls = endpoint ? runnerUrls(endpoint) : null;
  const pauseUrl = urls ? new URL(`/jobs/${encodeURIComponent(project.id)}/pause`, urls.origin).toString() : null;
  if (!token || !pauseUrl) return jsonError("Codex Runner 暂停接口未配置", 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNNER_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(pauseUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    return jsonError("Codex Runner 暂时无法确认暂停，任务状态保持不变", 502);
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => null) as { job?: { status?: string }; error?: string } | null;
  if (!response.ok || data?.job?.status !== "paused") {
    return jsonError(data?.error || `Codex Runner 未接受暂停（HTTP ${response.status}）`, response.status === 404 || response.status === 409 ? 409 : 502);
  }

  await getD1().prepare(`UPDATE projects SET status = 'paused', current_stage = 'paused', preview_url = NULL,
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ? AND status IN ('dispatching', 'building')`)
    .bind(project.id, user.id).run();
  return Response.json({
    project: { id: project.id, status: "paused", currentStage: "paused" },
    executionCapacity: await executionCapacity(user.id),
  }, {
    status: 202,
    headers: { "cache-control": "no-store" },
  });
}
