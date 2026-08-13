"use client";

import { FormEvent, useEffect, useState } from "react";

type AuthUser = { id: string; username: string };

type ProjectRecord = {
  id: string;
  name: string;
  prompt: string;
  status: string;
  currentStage: string | null;
  previewUrl: string | null;
  updatedAt: string;
  executionProgress?: number;
  executionMessage?: string;
  executionEvents?: Array<{ id?: string; at?: string; message?: string }>;
};

const EXAMPLES = [
  "做一个极简的个人记账网站，可按月份查看支出",
  "做一个活动报名页，带人数统计和移动端分享",
  "做一个之前没有预设过的业务网站",
];

const WORKFLOW = [
  ["01", "需求输入", "保留完整文本，可同时补充公开链接或文档链接"],
  ["02", "Codex API", "服务端把原始需求派发给受信任的云端 Codex Runner"],
  ["03", "Mobile Spec", "生成 Proposal、Specs、Design、Review 与 Tasks，并通过门禁"],
  ["04", "执行实现", "Codex 只依据原始需求和本次 Mobile Spec 编写项目代码"],
  ["05", "构建验证", "执行依赖锁定安装、测试、独立 Verify 与生产构建"],
  ["06", "部署结束", "部署独立站点；健康检查通过后返回外部 HTTPS URL"],
];

const STAGE_LABELS: Record<string, string> = {
  requirement: "需求已入队",
  "mobile-spec": "正在生成并验证 Mobile Spec",
  implementation: "Codex 正在实现页面",
  build: "正在测试与生产构建",
  deployment: "正在部署并执行健康检查",
  delivered: "部署完成",
};

const STAGES = [
  { key: "requirement", label: "需求", detail: "需求已保存" },
  { key: "mobile-spec", label: "Mobile Spec", detail: "规格与门禁" },
  { key: "implementation", label: "Codex", detail: "页面实现" },
  { key: "build", label: "构建", detail: "生产验证" },
  { key: "deployment", label: "部署", detail: "发布与检查" },
  { key: "delivered", label: "完成", detail: "返回 URL" },
];

function stageIndex(stage: string | null) {
  if (stage === "failed") return -1;
  return Math.max(0, STAGES.findIndex((item) => item.key === stage));
}

function formatEventTime(value?: string) {
  if (!value) return "刚刚";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "刚刚" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  if (!text.trim()) throw new Error(`${fallbackMessage}（HTTP ${response.status}，服务未返回详情）`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${fallbackMessage}（HTTP ${response.status}，服务响应格式异常）`);
  }
}

function Icon({ name }: { name: "menu" | "spark" | "send" | "chevron" | "x" | "plus" | "logout" | "external" }) {
  const glyphs = { menu: "☰", spark: "✦", send: "↑", chevron: "›", x: "×", plus: "+", logout: "↪", external: "↗" };
  return <span aria-hidden="true" className={`icon icon-${name}`}>{glyphs[name]}</span>;
}

function isExternalDeliveryUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "localhost" && !url.pathname.startsWith("/preview");
  } catch {
    return false;
  }
}

export function MobileBuildApp() {
  const [authState, setAuthState] = useState<"checking" | "signed-out" | "signed-in">("checking");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [sheet, setSheet] = useState<null | "menu" | "workflow">(null);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState("");
  const [genError, setGenError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const activeProject = projects.find((item) => item.id === activeProjectId) ?? null;

  useEffect(() => {
    fetch("/api/auth/session")
      .then(async (response) => {
        if (!response.ok) throw new Error("signed out");
        return readJsonResponse<{ user: AuthUser }>(response, "无法读取登录状态");
      })
      .then(({ user: signedInUser }) => {
        setUser(signedInUser);
        setAuthState("signed-in");
      })
      .catch(() => setAuthState("signed-out"));
  }, []);

  useEffect(() => {
    if (authState !== "signed-in") return;
    fetch("/api/projects")
      .then((response) => response.ok
        ? readJsonResponse<{ projects: ProjectRecord[] }>(response, "无法读取项目")
        : { projects: [] })
      .then((data) => setProjects(data.projects ?? []))
      .catch(() => setProjects([]));
  }, [authState]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    setLoggingIn(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      const data = await readJsonResponse<{ user?: AuthUser; error?: string }>(response, "登录失败");
      if (!response.ok) throw new Error(data.error || "登录失败");
      if (!data.user) throw new Error("登录成功，但服务未返回用户信息");
      setUser(data.user);
      setAuthState("signed-in");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    setAuthState("signed-out");
    setSheet(null);
    resetRequest();
  }

  async function handlePrompt(event: FormEvent) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || saving) return;
    setSaveError("");
    setSaving(true);
    try {
      const name = value.length > 28 ? `${value.slice(0, 28)}…` : value;
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, prompt: value }),
      });
      const data = await readJsonResponse<{ project?: ProjectRecord; error?: string }>(response, "需求保存失败");
      if (!response.ok || !data.project) throw new Error(data.error || "需求保存失败");
      setSubmittedPrompt(value);
      setActiveProjectId(data.project.id);
      setPrompt("");
      setPreviewUrl("");
      setGenError("");
      setGenProgress("");
      setProjects((items) => [data.project as ProjectRecord, ...items.filter((item) => item.id !== data.project?.id)]);
      await runProject(data.project.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "需求保存失败");
    } finally {
      setSaving(false);
    }
  }

  function resetRequest() {
    setPrompt("");
    setSubmittedPrompt("");
    setSaveError("");
    setActiveProjectId("");
    setGenerating(false);
    setGenProgress("");
    setGenError("");
    setPreviewUrl("");
  }

  function openProject(item: ProjectRecord) {
    setActiveProjectId(item.id);
    setSubmittedPrompt(item.prompt);
    setPreviewUrl(isExternalDeliveryUrl(item.previewUrl) ? item.previewUrl : "");
    setGenError(item.status === "failed" ? item.executionMessage || "该任务执行失败，可重新发起构建。" : "");
    setGenProgress(item.executionMessage || STAGE_LABELS[item.currentStage || ""] || item.status);
    setGenerating(item.status === "building");
    setSheet(null);
    if (item.status === "building") {
      void monitorProject(item.id)
        .catch((error) => setGenError(error instanceof Error ? error.message : "读取执行状态失败"))
        .finally(() => setGenerating(false));
    }
  }

  async function monitorProject(projectId: string) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      const poll = await fetch("/api/projects", { headers: { accept: "application/json" } });
      const snapshot = await readJsonResponse<{ projects?: ProjectRecord[]; error?: string }>(poll, "读取执行状态失败");
      if (!poll.ok) throw new Error(snapshot.error || "读取执行状态失败");
      const items = snapshot.projects ?? [];
      setProjects(items);
      const current = items.find((item) => item.id === projectId);
      if (!current) throw new Error("项目状态已丢失");
      setGenProgress(current.executionMessage || STAGE_LABELS[current.currentStage || ""] || `正在执行：${current.currentStage || current.status}`);
      if (current.status === "failed") throw new Error(current.executionMessage || `真实执行失败（阶段：${current.currentStage || "unknown"}）`);
      if (current.status === "delivered") {
        if (!isExternalDeliveryUrl(current.previewUrl)) throw new Error("执行器未返回通过校验的 HTTPS 部署地址");
        setPreviewUrl(current.previewUrl);
        return;
      }
    }
    throw new Error("任务仍在执行，请稍后从项目列表查看状态");
  }

  async function runProject(projectId: string) {
    if (!projectId || generating) return;
    setGenError("");
    setGenProgress("正在派发 Codex 任务…");
    setPreviewUrl("");
    setGenerating(true);
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `project-${projectId}` },
        body: JSON.stringify({}),
      });
      const data = await readJsonResponse<{ job?: { id: string }; error?: string; code?: string }>(response, "Codex 任务派发失败");
      if (!response.ok || !data.job) throw new Error(data.error || "Codex 任务派发失败");

      setGenProgress("任务已进入云端执行队列…");
      await monitorProject(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      setGenError(message.length > 600 ? `${message.slice(0, 600)}…` : message);
    } finally {
      setGenerating(false);
      setGenProgress("");
    }
  }

  function handleGenerate() {
    void runProject(activeProjectId);
  }

  const currentStageIndex = stageIndex(activeProject?.currentStage || (previewUrl ? "delivered" : "requirement"));
  const progressValue = activeProject?.status === "delivered"
    ? 100
    : Math.max(0, Math.min(99, activeProject?.executionProgress ?? (generating ? 5 : 0)));
  const liveMessage = activeProject?.executionMessage || genProgress || (previewUrl ? "部署和健康检查均已通过" : "等待开始真实构建");
  const liveEvents = activeProject?.executionEvents?.filter((event) => event.message).slice(-6).reverse() ?? [];

  if (authState === "checking") {
    return <main className="auth-shell loading-shell"><div className="brand-mark"><Icon name="spark" /></div><div className="loading-line"><span /></div></main>;
  }

  if (authState === "signed-out") {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-hero">
            <div className="brand-mark"><Icon name="spark" /></div>
            <div><p className="eyebrow">MOBILE BUILD</p><h1>一句话，<br />启动真实构建流程。</h1></div>
            <p className="auth-copy">需求经 Codex API 进入 Mobile Spec，再由受信任 Runner 实现、验证和发布。</p>
          </div>
          <form className="login-form" onSubmit={handleLogin}>
            <label><span>账号</span><input name="username" defaultValue="jonas" autoComplete="username" required /></label>
            <label><span>密码</span><input name="password" type="password" autoComplete="current-password" placeholder="输入密码" required /></label>
            {loginError ? <p className="form-error" role="alert">{loginError}</p> : null}
            <button className="primary-button login-button" type="submit" disabled={loggingIn}>{loggingIn ? "正在登录…" : "登录"}<Icon name="chevron" /></button>
          </form>
          <p className="auth-note"><span className="status-dot" />没有真实部署，不返回 URL</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="icon-button" aria-label="打开项目菜单" onClick={() => setSheet("menu")}><Icon name="menu" /></button>
        <div className="topbar-title"><strong>Mobile Build</strong><span><i className="status-dot" />真实构建 · 证据式交付</span></div>
        <button className="new-button" aria-label="新建需求" onClick={resetRequest}><Icon name="plus" /></button>
      </header>

      <section className={`conversation ${!submittedPrompt ? "conversation-empty" : ""}`}>
        {!submittedPrompt ? (
          <div className="welcome">
            <div className="welcome-orbit"><span><Icon name="spark" /></span></div>
            <p className="eyebrow">TEXT + LINKS</p>
            <h2>描述需求，<br />不要选择模板。</h2>
            <p>完整文本即可；也可以在文本里附上链接。二者会作为同一次 RequirementSource，不冲突。</p>
            <div className="example-list">{EXAMPLES.map((example) => <button key={example} onClick={() => setPrompt(example)}><span>{example}</span><Icon name="chevron" /></button>)}</div>
            <button className="workflow-entry" onClick={() => setSheet("workflow")}>查看完整流程与当前边界 <Icon name="chevron" /></button>
          </div>
        ) : (
          <div className="messages">
            <div className="message-user"><p>{submittedPrompt}</p></div>
            <div className="message-agent">
              <div className="agent-avatar"><Icon name="spark" /></div>
              <div><p className="agent-label">{activeProject ? activeProject.name : "需求已保存"}</p><p>{activeProject?.status === "delivered" ? "该历史项目已完成，可查看执行记录和交付页面。" : activeProject?.status === "building" ? "该项目正在真实执行，下面会持续同步进度与消息。" : "已原样保存，没有关键词分类或模板替换。"}</p></div>
            </div>
            <article className="plan-card scope-card">
              <div className="plan-head"><div><span>项目执行</span><h3>{activeProject?.status === "delivered" ? "交付完成" : activeProject?.status === "failed" ? "执行失败" : generating ? "正在构建" : "准备执行"}</h3></div><span className={`version-pill ${activeProject?.status === "failed" ? "failed" : ""}`}>{progressValue}%</span></div>
              <div className="live-progress" aria-label={`执行进度 ${progressValue}%`}><span style={{ width: `${progressValue}%` }} /></div>
              <div className="stage-grid">
                {STAGES.map((stage, index) => {
                  const done = activeProject?.status === "delivered" || index < currentStageIndex;
                  const running = activeProject?.status !== "failed" && index === currentStageIndex;
                  return <div className={`stage-step ${done ? "done" : ""} ${running ? "running" : ""}`} key={stage.key}><i>{done ? "✓" : index + 1}</i><span><strong>{stage.label}</strong><small>{stage.detail}</small></span></div>;
                })}
              </div>
              <section className="live-console" aria-live="polite">
                <div className="console-head"><span><i className={generating ? "status-dot" : "status-dot quiet"} />实时消息</span><small>{activeProject?.status === "building" ? "每 3 秒同步" : "最后状态"}</small></div>
                <p className="console-current">{liveMessage}</p>
                {liveEvents.length ? <ol>{liveEvents.map((event, index) => <li key={event.id || `${event.at}-${index}`}><time>{formatEventTime(event.at)}</time><span>{event.message}</span></li>)}</ol> : <p className="console-empty">开始执行后，这里会展示 Mobile Spec、Codex、构建和部署消息。</p>}
              </section>
              {genError ? <pre className="gen-error" role="alert">{genError}</pre> : null}
              <div className="plan-actions">
                {previewUrl ? <a className="primary-button" href={previewUrl} target="_blank" rel="noreferrer">打开交付页面<Icon name="external" /></a> : <button className="primary-button" onClick={handleGenerate} disabled={!submittedPrompt || !activeProjectId || generating}>{generating ? "执行中" : activeProject?.status === "failed" ? "重新执行" : "开始真实构建"}<Icon name="spark" /></button>}
                <button className="secondary-button" onClick={() => setSheet("workflow")}>流程说明<Icon name="chevron" /></button>
              </div>
            </article>
          </div>
        )}
      </section>

      <form className="composer" onSubmit={handlePrompt}>
        <div className="composer-inner"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入完整需求；可同时粘贴相关链接…" rows={1} aria-label="项目需求" /><button type="submit" disabled={!prompt.trim() || saving} aria-label="保存需求"><Icon name="send" /></button></div>
        <div className="composer-meta"><span><i className="status-dot" />{saving ? "正在保存" : "只保存原始需求"}</span><span>{saveError || "不会匹配模板"}</span></div>
      </form>

      {sheet ? <button className="sheet-backdrop" aria-label="关闭面板" onClick={() => setSheet(null)} /> : null}
      {sheet === "menu" ? (
        <aside className="bottom-sheet menu-sheet">
          <div className="sheet-handle" />
          <div className="sheet-title"><div><p className="eyebrow">WORKSPACE</p><h3>需求与账户</h3></div><button onClick={() => setSheet(null)}><Icon name="x" /></button></div>
          <div className="account-row"><div className="account-avatar">J</div><div><strong>{user?.username}</strong><span>MVP 本地账户</span></div><button aria-label="退出登录" onClick={handleLogout}><Icon name="logout" /></button></div>
          <div className="recent-projects">
            <div className="list-heading"><span>已保存需求</span><small>{projects.length}</small></div>
            {projects.length ? projects.slice(0, 12).map((item) => <button className={`project-row ${item.id === activeProjectId ? "active" : ""}`} type="button" onClick={() => openProject(item)} key={item.id}><span>{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><small>{item.executionMessage || (isExternalDeliveryUrl(item.previewUrl) ? "已交付 · 点击查看详情" : STAGE_LABELS[item.currentStage || ""] || item.status)}</small></div><Icon name="chevron" /></button>) : <p className="empty-list">保存第一条完整需求后会显示在这里。</p>}
          </div>
        </aside>
      ) : null}

      {sheet === "workflow" ? (
        <aside className="bottom-sheet detail-sheet workflow-sheet">
          <div className="sheet-handle" />
          <div className="sheet-title"><div><p className="eyebrow">DELIVERY PIPELINE</p><h3>真实执行链路</h3></div><button onClick={() => setSheet(null)}><Icon name="x" /></button></div>
          <div className="workflow-list">{WORKFLOW.map(([number, title, detail]) => <div key={number}><span>{number}</span><section><strong>{title}</strong><p>{detail}</p></section></div>)}</div>
          <p className="workflow-boundary">任一门禁失败就停止并显示真实错误。浏览器无权写入“已交付”；只有受信任的 Runner 携带完整证据回调后，系统才保存部署 URL。</p>
        </aside>
      ) : null}
    </main>
  );
}
