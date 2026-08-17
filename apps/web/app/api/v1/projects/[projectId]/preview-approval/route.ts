import { getD1, jsonError, requireSession } from "../../../../../lib/server-auth";
import { resolveRunnerEndpoint, runnerUrls } from "../../../../../lib/runner-endpoint";

const RUNNER_TIMEOUT_MS = 12_000;

type PreviewArtifact = { id?: unknown; setId?: unknown; format?: unknown };

export async function POST(request: Request, context: RouteContext<"/api/v1/projects/[projectId]/preview-approval">) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  const payload = await request.json().catch(() => null) as { previewId?: unknown } | null;
  const previewId = typeof payload?.previewId === "string" ? payload.previewId.trim().slice(0, 160) : "";
  if (!previewId) return jsonError("请选择一份预览方案", 400);

  const { projectId } = await context.params;
  const project = await getD1().prepare(`SELECT id, prompt, status, current_stage AS currentStage FROM projects
    WHERE id = ? AND owner_user_id = ? LIMIT 1`).bind(projectId, user.id)
    .first<{ id: string; prompt: string; status: string; currentStage: string | null }>();
  if (!project) return jsonError("项目不存在", 404);
  if (["dispatching", "building"].includes(project.status)) return jsonError("任务执行中，暂时不能更换预览确认", 409);
  if (project.status !== "awaiting_approval" && !(project.status === "ready" && project.currentStage === "preview")) {
    return jsonError("当前项目不在预览确认阶段", 409);
  }

  const endpoint = await resolveRunnerEndpoint();
  const token = process.env.CODEX_RUNNER_TOKEN;
  const urls = endpoint ? runnerUrls(endpoint) : null;
  if (!urls || !token) return jsonError("Codex Runner 当前不可用，无法验证预览方案", 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNNER_TIMEOUT_MS);
  try {
    const response = await fetch(`${urls.origin}/jobs/${encodeURIComponent(project.id)}/artifacts/preview`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ requirement: project.prompt }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null) as { checkpointed?: boolean; artifacts?: PreviewArtifact[]; error?: string } | null;
    if (!response.ok || !data?.checkpointed) return jsonError(data?.error || "预览产物尚未就绪", response.status || 409);
    const selected = data.artifacts?.find((artifact) => artifact.id === previewId && artifact.format === "svg");
    const previewSetId = typeof selected?.setId === "string" ? selected.setId : "";
    if (!selected || !previewSetId) return jsonError("所选预览已失效，请刷新后重新选择", 409);

    await getD1().batch([
      getD1().prepare(`INSERT INTO project_preview_approvals (
        project_id, owner_user_id, status, preview_set_id, selected_preview_id, approved_at
      ) VALUES (?, ?, 'approved', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(project_id) DO UPDATE SET
        owner_user_id = excluded.owner_user_id,
        status = 'approved',
        preview_set_id = excluded.preview_set_id,
        selected_preview_id = excluded.selected_preview_id,
        approved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP`).bind(project.id, user.id, previewSetId, previewId),
      getD1().prepare(`UPDATE projects SET status = 'ready', current_stage = 'preview', preview_url = NULL,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?`).bind(project.id, user.id),
    ]);
    return Response.json({ approved: true, previewSetId, selectedPreviewId: previewId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? `预览确认失败：${error.message}` : "预览确认失败", 502);
  } finally {
    clearTimeout(timer);
  }
}
