import { getD1, jsonError } from "../../../../../lib/server-auth";

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function validDeliveryUrl(value: string, controlHostname: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "localhost" && url.hostname !== controlHostname && !url.pathname.startsWith("/preview");
  } catch {
    return false;
  }
}

export async function POST(request: Request, context: RouteContext<"/api/v1/projects/[projectId]/delivery">) {
  const expected = process.env.RUNNER_CALLBACK_TOKEN || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !supplied || !timingSafeEqual(expected, supplied)) return jsonError("未授权的执行器", 401);
  const { projectId } = await context.params;
  const body = await request.json().catch(() => null) as {
    status?: unknown;
    stage?: unknown;
    url?: unknown;
    evidence?: { mobileSpecPassed?: unknown; buildPassed?: unknown; deployPassed?: unknown };
  } | null;
  const status = body?.status === "delivered"
    ? "delivered"
    : body?.status === "failed"
      ? "failed"
      : body?.status === "paused" ? "paused" : "building";
  const stage = typeof body?.stage === "string" ? body.stage.slice(0, 40) : status;
  const url = typeof body?.url === "string" ? body.url.slice(0, 1000) : null;

  if (status === "delivered") {
    const evidence = body?.evidence;
    if (!evidence?.mobileSpecPassed || !evidence.buildPassed || !evidence.deployPassed || !url || !validDeliveryUrl(url, new URL(request.url).hostname)) {
      return jsonError("交付证据或 HTTPS 部署 URL 不完整", 422);
    }
  }

  const result = await getD1().prepare(`UPDATE projects SET status = ?, current_stage = ?, preview_url = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(status, stage, status === "delivered" ? url : null, projectId).run();
  if (!result.meta.changes) return jsonError("项目不存在", 404);
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request, context: RouteContext<"/api/v1/projects/[projectId]/delivery">) {
  const expected = process.env.RUNNER_CALLBACK_TOKEN || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  // Sites injects this header only after its outer access policy authenticates
  // the viewer. This site is owner-only, so the owner can inspect their own
  // stored requirement without exposing the runner secret to the browser.
  const authenticatedSiteOwner = Boolean(request.headers.get("oai-authenticated-user-email"));
  const trustedRunner = Boolean(expected && supplied && timingSafeEqual(expected, supplied));
  if (!authenticatedSiteOwner && !trustedRunner) return jsonError("未授权的执行器", 401);
  const { projectId } = await context.params;
  const project = await getD1().prepare(`SELECT id, name, prompt, status, current_stage AS currentStage
    FROM projects WHERE id = ? LIMIT 1`).bind(projectId).first();
  if (!project) return jsonError("项目不存在", 404);
  return Response.json({ project }, { headers: { "cache-control": "no-store" } });
}
