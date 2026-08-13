import { getD1, jsonError, requireSession } from "../../../lib/server-auth";

type ProjectRow = { id: string; status: string };

export async function DELETE(request: Request, context: RouteContext<"/api/projects/[projectId]">) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  const { projectId } = await context.params;
  const project = await getD1().prepare(`SELECT id, status FROM projects
    WHERE id = ? AND owner_user_id = ? LIMIT 1`).bind(projectId, user.id).first<ProjectRow>();
  if (!project) return jsonError("项目不存在", 404);
  if (["dispatching", "building"].includes(project.status)) {
    return jsonError("进行中的需求不能删除，请等待执行结束", 409);
  }
  const result = await getD1().prepare(`DELETE FROM projects WHERE id = ? AND owner_user_id = ?
    AND status NOT IN ('dispatching', 'building')`).bind(projectId, user.id).run();
  if (!result.meta.changes) return jsonError("项目状态已变化，请刷新后重试", 409);
  return Response.json({ deleted: true, projectId }, { headers: { "cache-control": "no-store" } });
}
