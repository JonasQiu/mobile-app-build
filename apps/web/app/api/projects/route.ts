import { getD1, jsonError, requireSession } from "../../lib/server-auth";
import { resolveRunnerEndpoint, runnerUrls } from "../../lib/runner-endpoint";

type ProjectRow = {
  id: string;
  name: string;
  prompt: string;
  status: string;
  currentStage: string | null;
  previewUrl: string | null;
  updatedAt: string;
  executionProgress?: number;
  executionMessage?: string;
  executionEvents?: RunnerEvent[];
  executionCheckpoints?: string[];
};

type RunnerEvent = {
  id?: string;
  at?: string;
  message?: string;
  stage?: string;
  kind?: string;
  progress?: number;
};

type RunnerJob = {
  status?: string;
  stage?: string;
  url?: string;
  error?: string;
  progress?: number;
  message?: string;
  events?: RunnerEvent[];
  evidence?: { mobileSpecPassed?: boolean; buildPassed?: boolean; deployPassed?: boolean };
  checkpoints?: string[];
};

const MAX_ACTIVE_PROJECTS = 2;
const ACTIVE_PROJECT_STATUSES = ["dispatching", "building"];
// Pull terminal recovery states too: the control-plane callback can be blocked
// by an outer access gate while the authenticated Runner job still succeeds.
// A delivered D1 row remains authoritative after Runner restarts, so it is the
// only normal state intentionally excluded from opportunistic reconciliation.
const RUNNER_SYNC_STATUSES = [...ACTIVE_PROJECT_STATUSES, "queued", "ready", "paused", "failed"];

function validDeliveryUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname !== "localhost"
      && url.hostname !== "mobile-app-build-mvp.long229260097.chatgpt.site"
      && !url.pathname.startsWith("/preview");
  } catch {
    return false;
  }
}

async function syncRunnerState(userId: string, projects: ProjectRow[]) {
  const endpoint = await resolveRunnerEndpoint();
  const token = process.env.CODEX_RUNNER_TOKEN;
  if (!endpoint || !token) return;
  const urls = runnerUrls(endpoint);
  if (!urls) return;
  const origin = urls.origin;
  await Promise.all(projects.filter((project) => RUNNER_SYNC_STATUSES.includes(project.status)).map(async (project) => {
    try {
      const response = await fetch(`${origin}/jobs/${encodeURIComponent(project.id)}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!response.ok) return;
      const data = await response.json() as { job?: RunnerJob };
      const job = data.job;
      if (!job) return;
      project.executionProgress = Math.max(0, Math.min(100, Number(job.progress) || 0));
      project.executionMessage = typeof job.message === "string" ? job.message.slice(0, 600) : undefined;
      project.executionEvents = Array.isArray(job.events)
        ? job.events.slice(-12).map((event) => ({
          id: event.id,
          at: event.at,
          message: typeof event.message === "string" ? event.message.slice(0, 600) : undefined,
          stage: typeof event.stage === "string" ? event.stage.slice(0, 40) : undefined,
          kind: typeof event.kind === "string" ? event.kind.slice(0, 24) : undefined,
          progress: Math.max(0, Math.min(100, Number(event.progress) || 0)),
        }))
        : [];
      project.executionCheckpoints = Array.isArray(job.checkpoints)
        ? job.checkpoints.filter((stage) => ["mobile-spec", "implementation", "build", "deployment"].includes(stage))
        : [];
      if (job.status === "failed") {
        await getD1().prepare(`UPDATE projects SET status = 'failed', current_stage = 'failed',
          updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?`).bind(project.id, userId).run();
        project.status = "failed";
        project.currentStage = "failed";
        return;
      }
      if (job.status === "paused") {
        await getD1().prepare(`UPDATE projects SET status = 'paused', current_stage = 'paused', preview_url = NULL,
          updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?`).bind(project.id, userId).run();
        project.status = "paused";
        project.currentStage = "paused";
        project.previewUrl = null;
        return;
      }
      if (job.status === "checkpointed" && job.stage && ["mobile-spec", "implementation", "build", "deployment"].includes(job.stage)) {
        await getD1().prepare(`UPDATE projects SET status = 'ready', current_stage = ?, preview_url = NULL,
          updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?`).bind(job.stage, project.id, userId).run();
        project.status = "ready";
        project.currentStage = job.stage;
        project.previewUrl = null;
        return;
      }
      if (job.status === "delivered") {
        const evidence = job.evidence;
        if (!evidence?.mobileSpecPassed || !evidence.buildPassed || !evidence.deployPassed || !validDeliveryUrl(job.url)) {
          await getD1().prepare(`UPDATE projects SET status = 'failed', current_stage = 'failed',
            updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?`).bind(project.id, userId).run();
          project.status = "failed";
          project.currentStage = "failed";
          return;
        }
        await getD1().prepare(`UPDATE projects SET status = 'delivered', current_stage = 'delivered', preview_url = ?,
          updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?`).bind(job.url, project.id, userId).run();
        project.status = "delivered";
        project.currentStage = "delivered";
        project.previewUrl = job.url || null;
        return;
      }
      if (job.stage && ["mobile-spec", "implementation", "build", "deployment"].includes(job.stage)) {
        await getD1().prepare(`UPDATE projects SET status = 'building', current_stage = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND owner_user_id = ?`).bind(job.stage, project.id, userId).run();
        project.status = "building";
        project.currentStage = job.stage;
      }
    } catch {
      // A temporary Runner read failure must not invent a terminal state.
    }
  }));
}

export async function GET(request: Request) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  const result = await getD1().prepare(`SELECT id, name, prompt, status,
    current_stage AS currentStage, preview_url AS previewUrl, updated_at AS updatedAt
    FROM projects WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT 20`)
    .bind(user.id).all<ProjectRow>();
  await syncRunnerState(user.id, result.results);
  await getD1().prepare(`UPDATE projects SET status = 'failed', current_stage = 'failed', updated_at = CURRENT_TIMESTAMP
    WHERE owner_user_id = ? AND status = 'dispatching' AND updated_at < datetime('now', '-2 minutes')`)
    .bind(user.id).run();
  for (const project of result.results) {
    const updatedAt = project.updatedAt.includes("T") ? project.updatedAt : `${project.updatedAt.replace(" ", "T")}Z`;
    if (project.status === "dispatching" && Date.parse(updatedAt) < Date.now() - 120_000) {
      project.status = "failed";
      project.currentStage = "failed";
      project.executionMessage = "Runner 在 2 分钟内未确认任务，派发占位已释放";
    }
  }
  const capacity = await getD1().prepare(`SELECT COUNT(*) AS active FROM projects
    WHERE owner_user_id = ? AND status IN ('dispatching', 'building')`)
    .bind(user.id).first<{ active: number }>();
  return Response.json({
    projects: result.results,
    executionCapacity: { active: Number(capacity?.active) || 0, max: MAX_ACTIVE_PROJECTS },
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  const payload = await request.json().catch(() => null) as { name?: unknown; prompt?: unknown; executor?: unknown } | null;
  const name = typeof payload?.name === "string" ? payload.name.trim().slice(0, 100) : "";
  const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim().slice(0, 4000) : "";
  if (!name || !prompt) return jsonError("项目名称和描述不能为空", 400);
  const capacity = await getD1().prepare(`SELECT COUNT(*) AS active FROM projects
    WHERE owner_user_id = ? AND status IN ('dispatching', 'building')`)
    .bind(user.id).first<{ active: number }>();
  if (Number(capacity?.active) >= MAX_ACTIVE_PROJECTS) {
    return Response.json({
      error: "最多只能同时执行 2 个需求，请等待其中一个完成后再提交",
      code: "EXECUTION_LIMIT_REACHED",
      executionCapacity: { active: Number(capacity?.active) || MAX_ACTIVE_PROJECTS, max: MAX_ACTIVE_PROJECTS },
    }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  const id = `prj_${crypto.randomUUID()}`;
  await getD1().prepare(`INSERT INTO projects (id, owner_user_id, name, prompt, status, current_stage)
    VALUES (?, ?, ?, ?, 'queued', 'requirement')`).bind(id, user.id, name, prompt).run();
  return Response.json({ project: { id, name, prompt, status: "queued", currentStage: "requirement", previewUrl: null } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  // A browser must never be able to claim a successful build or inject a URL.
  // Only the trusted runner callback will transition a project after verified
  // Mobile Spec, build, and deployment evidence exists.
  return jsonError("项目状态由可信执行器更新，客户端不能直接标记交付", 403);
}
