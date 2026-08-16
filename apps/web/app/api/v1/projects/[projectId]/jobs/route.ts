import { getD1, jsonError, requireSession } from "../../../../../lib/server-auth";
import { resolveRunnerEndpoint, runnerUrls } from "../../../../../lib/runner-endpoint";

type ProjectRow = { id: string; status: string; prompt: string; currentStage: string | null; previewUrl: string | null };
type ExecutionMode = "continue" | "rerun" | "step";
type ExecutionStage = "mobile-spec" | "implementation" | "build" | "deployment";

const EXECUTION_STAGES: ExecutionStage[] = ["mobile-spec", "implementation", "build", "deployment"];

const MAX_ACTIVE_PROJECTS = 2;
const RUNNER_REQUEST_TIMEOUT_MS = 10_000;

async function fetchRunner(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNNER_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request, context: RouteContext<"/api/v1/projects/[projectId]/jobs">) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  const payload = await request.json().catch(() => ({})) as { mode?: unknown; targetStage?: unknown };
  const mode: ExecutionMode = ["continue", "rerun", "step"].includes(String(payload.mode))
    ? String(payload.mode) as ExecutionMode
    : "continue";
  const targetStage = typeof payload.targetStage === "string" && EXECUTION_STAGES.includes(payload.targetStage as ExecutionStage)
    ? payload.targetStage as ExecutionStage
    : null;
  if (mode === "step" && !targetStage) return jsonError("单步执行需要指定有效步骤", 400);
  const { projectId } = await context.params;
  const project = await getD1().prepare(`SELECT id, status, prompt, current_stage AS currentStage, preview_url AS previewUrl FROM projects
    WHERE id = ? AND owner_user_id = ? LIMIT 1`).bind(projectId, user.id).first<ProjectRow>();
  if (!project) return jsonError("项目不存在", 404);
  const token = process.env.CODEX_RUNNER_TOKEN;
  if (!token || !process.env.RUNNER_CALLBACK_TOKEN) {
    return Response.json({
      error: "Codex Runner 正在维护，当前不会启动或伪造任务，请稍后重试",
      code: "EXECUTOR_OFFLINE",
      retryable: false,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const endpoint = await resolveRunnerEndpoint();
  const resolvedRunnerUrls = endpoint ? runnerUrls(endpoint) : null;
  if (!resolvedRunnerUrls) {
    return Response.json({
      error: "Codex Runner 地址配置无效，任务尚未启动",
      code: "EXECUTOR_CONFIG_INVALID",
      retryable: false,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  try {
    const healthResponse = await fetchRunner(resolvedRunnerUrls.healthUrl, {
      headers: { accept: "application/json" },
    });
    const health = healthResponse.headers.get("content-type")?.includes("application/json")
      ? await healthResponse.json().catch(() => null) as { ok?: boolean; deploymentProviderConfigured?: boolean } | null
      : null;
    if (!healthResponse.ok || !health?.ok || !health.deploymentProviderConfigured) {
      return Response.json({
        error: "Codex Runner 当前不可用，任务尚未启动，请稍后重试",
        code: "EXECUTOR_UNHEALTHY",
        retryable: true,
      }, { status: 503, headers: { "cache-control": "no-store" } });
    }
  } catch {
    return Response.json({
      error: "Codex Runner 当前无法连接，任务尚未启动，请稍后重试",
      code: "EXECUTOR_UNREACHABLE",
      retryable: true,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  let claimedSlot = false;
  if (project.status === "dispatching") return jsonError("该需求正在派发，请稍后查看实时消息", 409);
  if (project.status !== "building") {
    const claim = await getD1().prepare(`UPDATE projects
      SET status = 'dispatching', current_stage = ?, preview_url = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND owner_user_id = ? AND status = ?
        AND (SELECT COUNT(*) FROM projects WHERE owner_user_id = ?
          AND status IN ('dispatching', 'building')) < ?`)
      .bind(targetStage || "mobile-spec", project.id, user.id, project.status, user.id, MAX_ACTIVE_PROJECTS).run();
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
    await getD1().prepare(`UPDATE projects SET status = ?, current_stage = ?, preview_url = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND owner_user_id = ? AND status = 'dispatching'`)
      .bind(project.status, project.currentStage, project.previewUrl, project.id, user.id).run();
  };

  const idempotencyKey = request.headers.get("idempotency-key") || `job-${project.id}`;
  const callbackUrl = new URL(`/api/v1/projects/${encodeURIComponent(project.id)}/delivery`, request.url).toString();
  const prompt = [
    "执行 Mobile Build 真实交付任务。",
    `项目 ID：${project.id}`,
    `原始需求：${project.prompt}`,
    "严格按顺序执行：Mobile Spec Proposal/Specs/Design/Review/Tasks 门禁 → Codex 实现 → npm ci → 测试与生产构建 → DeploymentProvider 发布 → 健康检查。",
    mode === "rerun" ? "本次明确要求重新执行：清除已有检查点后完整重建。" : mode === "step" ? `本次只处理指定步骤：${targetStage}；已成功则直接复用，失败则沿用该步骤的错误上下文原地修复。` : "复用同一需求中已经成功的步骤，从第一个未完成步骤的失败位置继续修复。",
    "任何阶段失败都必须报告失败，禁止生成站内 /preview URL，禁止把记录页或模板页当成交付物。",
  ].join("\n");

  let response: Response;
  try {
    response = await fetchRunner(resolvedRunnerUrls.jobsUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        projectId: project.id,
        requirement: project.prompt,
        instructions: prompt,
        callbackUrl,
        mode,
        targetStage,
        previousDeliveryUrl: project.previewUrl,
      }),
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? `Runner 响应未知：${error.message}。系统将继续同步任务状态，避免重复占用执行名额。` : "Runner 响应未知，系统将继续同步任务状态",
      code: "EXECUTOR_DISPATCH_UNKNOWN",
      retryable: true,
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json().catch(() => null) as {
      job?: { id?: string; status?: string; stage?: string; url?: string; progress?: number; message?: string; checkpoints?: string[] };
      error?: string | { message?: string };
    } | null
    : null;
  const jobId = data?.job?.id;
  if (!response.ok || !jobId) {
    await releaseClaim();
    const runnerError = typeof data?.error === "string" ? data.error : data?.error?.message;
    const fallback = response.ok
      ? "Codex Runner 响应缺少任务编号，任务未启动"
      : `Codex Runner 拒绝任务（HTTP ${response.status}）`;
    return Response.json({
      error: runnerError || fallback,
      code: "EXECUTOR_DISPATCH_FAILED",
      retryable: response.status >= 500,
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }

  if (data.job?.status === "delivered" && data.job.url) {
    await getD1().prepare(`UPDATE projects SET status = 'delivered', current_stage = 'delivered',
      preview_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?`)
      .bind(data.job.url, project.id, user.id).run();
    return Response.json({ job: { ...data.job, projectId: project.id } }, { status: 200, headers: { "cache-control": "no-store" } });
  }

  const currentStage = data.job?.stage && EXECUTION_STAGES.includes(data.job.stage as ExecutionStage)
    ? data.job.stage
    : targetStage || "mobile-spec";
  await getD1().prepare(`UPDATE projects SET status = 'building', current_stage = ?,
    preview_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?`)
    .bind(currentStage, project.id, user.id).run();
  return Response.json({
    job: { ...data.job, id: jobId, projectId: project.id, status: data.job?.status || "queued", currentStage },
  }, { status: 202, headers: { "cache-control": "no-store" } });
}
