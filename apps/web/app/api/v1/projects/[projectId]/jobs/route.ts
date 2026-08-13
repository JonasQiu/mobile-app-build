import { getD1, jsonError, requireSession } from "../../../../../lib/server-auth";

type ProjectRow = { id: string; status: string; prompt: string; currentStage: string | null };

const MAX_ACTIVE_PROJECTS = 2;

export async function POST(request: Request, context: RouteContext<"/api/v1/projects/[projectId]/jobs">) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  const { projectId } = await context.params;
  const project = await getD1().prepare(`SELECT id, status, prompt, current_stage AS currentStage FROM projects
    WHERE id = ? AND owner_user_id = ? LIMIT 1`).bind(projectId, user.id).first<ProjectRow>();
  if (!project) return jsonError("项目不存在", 404);
  if (project.status === "delivered") return jsonError("项目已经交付", 409);

  const endpoint = process.env.CODEX_RUNNER_URL;
  const token = process.env.CODEX_RUNNER_TOKEN;
  if (!endpoint || !token || !process.env.RUNNER_CALLBACK_TOKEN) {
    return Response.json({
      error: "Codex Runner 正在维护，当前不会启动或伪造任务，请稍后重试",
      code: "EXECUTOR_OFFLINE",
      retryable: false,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  let claimedSlot = false;
  if (project.status === "dispatching") return jsonError("该需求正在派发，请稍后查看实时消息", 409);
  if (project.status !== "building") {
    const claim = await getD1().prepare(`UPDATE projects
      SET status = 'dispatching', current_stage = 'mobile-spec', preview_url = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND owner_user_id = ? AND status = ?
        AND (SELECT COUNT(*) FROM projects WHERE owner_user_id = ?
          AND status IN ('dispatching', 'building')) < ?`)
      .bind(project.id, user.id, project.status, user.id, MAX_ACTIVE_PROJECTS).run();
    if (!claim.meta.changes) {
      return Response.json({
        error: "最多只能同时执行 2 个需求，请等待其中一个完成后再试",
        code: "EXECUTION_LIMIT_REACHED",
        executionCapacity: { active: MAX_ACTIVE_PROJECTS, max: MAX_ACTIVE_PROJECTS },
      }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    claimedSlot = true;
  }

  const releaseClaim = async () => {
    if (!claimedSlot) return;
    await getD1().prepare(`UPDATE projects SET status = ?, current_stage = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND owner_user_id = ? AND status = 'dispatching'`)
      .bind(project.status, project.currentStage, project.id, user.id).run();
  };

  const idempotencyKey = request.headers.get("idempotency-key") || `job-${project.id}`;
  const callbackUrl = new URL(`/api/v1/projects/${encodeURIComponent(project.id)}/delivery`, request.url).toString();
  const prompt = [
    "执行 Mobile Build 真实交付任务。",
    `项目 ID：${project.id}`,
    `原始需求：${project.prompt}`,
    "严格按顺序执行：Mobile Spec Proposal/Specs/Design/Review/Tasks 门禁 → Codex 实现 → npm ci → 测试与生产构建 → DeploymentProvider 发布 → 健康检查。",
    "任何阶段失败都必须报告失败，禁止生成站内 /preview URL，禁止把记录页或模板页当成交付物。",
  ].join("\n");

  let response: Response;
  try {
    response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ projectId: project.id, requirement: project.prompt, instructions: prompt, callbackUrl }),
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? `Runner 响应未知：${error.message}。系统将继续同步任务状态，避免重复占用执行名额。` : "Runner 响应未知，系统将继续同步任务状态",
      code: "EXECUTOR_DISPATCH_UNKNOWN",
      retryable: true,
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  const data = await response.json().catch(() => null) as {
    job?: { id?: string };
    error?: string | { message?: string };
  } | null;
  const jobId = data?.job?.id;
  if (!response.ok || !jobId) {
    await releaseClaim();
    return Response.json({
      error: typeof data?.error === "string" ? data.error : data?.error?.message || "云端 Codex Runner 未接受任务",
      code: "EXECUTOR_DISPATCH_FAILED",
      retryable: response.status >= 500,
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }

  await getD1().prepare(`UPDATE projects SET status = 'building', current_stage = 'mobile-spec',
    preview_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?`)
    .bind(project.id, user.id).run();
  return Response.json({
    job: { id: jobId, projectId: project.id, status: "queued", currentStage: "mobile-spec" },
  }, { status: 202, headers: { "cache-control": "no-store" } });
}
