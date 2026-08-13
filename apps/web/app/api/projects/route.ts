import { getD1, jsonError, requireSession } from "../../lib/server-auth";

type ProjectRow = {
  id: string;
  name: string;
  prompt: string;
  status: string;
  currentStage: string | null;
  previewUrl: string | null;
  updatedAt: string;
};

export async function GET(request: Request) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  const result = await getD1().prepare(`SELECT id, name, prompt, status,
    current_stage AS currentStage, preview_url AS previewUrl, updated_at AS updatedAt
    FROM projects WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT 20`)
    .bind(user.id).all<ProjectRow>();
  return Response.json({ projects: result.results }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  const payload = await request.json().catch(() => null) as { name?: unknown; prompt?: unknown; executor?: unknown } | null;
  const name = typeof payload?.name === "string" ? payload.name.trim().slice(0, 100) : "";
  const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim().slice(0, 4000) : "";
  if (!name || !prompt) return jsonError("项目名称和描述不能为空", 400);
  const id = `prj_${crypto.randomUUID()}`;
  await getD1().prepare(`INSERT INTO projects (id, owner_user_id, name, prompt, status, current_stage)
    VALUES (?, ?, ?, ?, 'draft', 'requirement')`).bind(id, user.id, name, prompt).run();
  return Response.json({ project: { id, name, prompt, status: "draft", currentStage: "requirement", previewUrl: null } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  const payload = await request.json().catch(() => null) as { id?: unknown; status?: unknown; currentStage?: unknown; previewUrl?: unknown } | null;
  const id = typeof payload?.id === "string" ? payload.id : "";
  const status = typeof payload?.status === "string" ? payload.status.slice(0, 30) : "building";
  const currentStage = typeof payload?.currentStage === "string" ? payload.currentStage.slice(0, 40) : null;
  const previewUrl = typeof payload?.previewUrl === "string" ? payload.previewUrl.slice(0, 1000) : null;
  if (!id) return jsonError("缺少项目 ID", 400);
  const result = await getD1().prepare(`UPDATE projects SET status = ?, current_stage = ?, preview_url = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?`)
    .bind(status, currentStage, previewUrl, id, user.id).run();
  if (!result.meta.changes) return jsonError("项目不存在", 404);
  return Response.json({ ok: true });
}
