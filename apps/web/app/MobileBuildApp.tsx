"use client";

import { FormEvent, useEffect, useState } from "react";

type AuthUser = { id: string; username: string };
type ExecutorMode = "auto" | "local" | "cloud";

type ProjectRecord = {
  id: string;
  name: string;
  prompt: string;
  status: string;
  currentStage: string | null;
  previewUrl: string | null;
  updatedAt: string;
};

const EXAMPLES = [
  "做一个极简的个人记账网站，可按月份查看支出",
  "做一个活动报名页，带人数统计和移动端分享",
  "做一个之前没有预设过的业务网站",
];

const WORKFLOW = [
  ["01", "需求输入", "保留完整文本，可同时补充公开链接或文档链接"],
  ["02", "Mobile Spec", "生成 Proposal、Specs、Design、Review 与 Tasks"],
  ["03", "Agent 实现", "本机 Desktop Agent 或隔离 Cloud Agent 按规格编写代码"],
  ["04", "验证构建", "执行 lint、类型、测试、独立 Verify 与生产构建"],
  ["05", "发布交付", "DeploymentProvider 发布独立项目并返回外部 HTTPS URL"],
];

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
    return (url.protocol === "https:" || url.protocol === "http:") && !url.pathname.startsWith("/preview");
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
  const [executor, setExecutor] = useState<ExecutorMode>("auto");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [sheet, setSheet] = useState<null | "menu" | "workflow">(null);

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
        body: JSON.stringify({ name, prompt: value, executor }),
      });
      const data = await readJsonResponse<{ project?: ProjectRecord; error?: string }>(response, "需求保存失败");
      if (!response.ok || !data.project) throw new Error(data.error || "需求保存失败");
      setSubmittedPrompt(value);
      setPrompt("");
      setProjects((items) => [data.project as ProjectRecord, ...items.filter((item) => item.id !== data.project?.id)]);
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
  }

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
            <p className="auth-copy">需求先进入 Mobile Spec，再由本机或云端 Agent 实现、验证和发布。</p>
          </div>
          <form className="login-form" onSubmit={handleLogin}>
            <label><span>账号</span><input name="username" defaultValue="jonas" autoComplete="username" required /></label>
            <label><span>密码</span><input name="password" type="password" autoComplete="current-password" placeholder="输入密码" required /></label>
            {loginError ? <p className="form-error" role="alert">{loginError}</p> : null}
            <button className="primary-button login-button" type="submit" disabled={loggingIn}>{loggingIn ? "正在登录…" : "登录"}<Icon name="chevron" /></button>
          </form>
          <p className="auth-note"><span className="status-dot" />当前为流程 MVP · 不生成模板预览</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="icon-button" aria-label="打开项目菜单" onClick={() => setSheet("menu")}><Icon name="menu" /></button>
        <div className="topbar-title"><strong>Mobile Build</strong><span><i className="status-dot" />流程方案整理中</span></div>
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
              <div><p className="agent-label">需求已保存</p><p>已原样保存为待执行需求，没有做关键词分类，也没有生成模板页面。下一步接入任务协调服务后，才会触发真实 Mobile Spec artifacts 和 Agent 执行。</p></div>
            </div>
            <article className="plan-card scope-card">
              <div className="plan-head"><div><span>执行目标</span><h3>{executor === "local" ? "Desktop Agent" : executor === "cloud" ? "Cloud Agent" : "自动选择"}</h3></div><span className="version-pill">DRAFT</span></div>
              <div className="truth-note"><strong>当前没有伪造构建结果</strong><span>未产生代码、测试结论、部署记录或 URL。只有 DeploymentProvider 真正返回外部地址后，项目才可标记为已交付。</span></div>
              <div className="plan-actions"><button className="secondary-button" onClick={() => { setPrompt(submittedPrompt); setSubmittedPrompt(""); }}>修改需求</button><button className="primary-button" onClick={() => setSheet("workflow")}>查看执行流程<Icon name="chevron" /></button></div>
            </article>
          </div>
        )}
      </section>

      <form className="composer" onSubmit={handlePrompt}>
        <div className="executor-compact" role="group" aria-label="选择执行位置">
          {(["auto", "local", "cloud"] as ExecutorMode[]).map((mode) => <button type="button" key={mode} className={executor === mode ? "active" : ""} onClick={() => setExecutor(mode)}>{mode === "auto" ? "自动" : mode === "local" ? "本机" : "云端"}</button>)}
        </div>
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
            {projects.length ? projects.slice(0, 8).map((item) => {
              const row = <><span>{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><small>{isExternalDeliveryUrl(item.previewUrl) ? "已由部署平台交付" : "待接入真实执行器"}</small></div>{isExternalDeliveryUrl(item.previewUrl) ? <Icon name="external" /> : <Icon name="chevron" />}</>;
              return isExternalDeliveryUrl(item.previewUrl) ? <a className="project-row" href={item.previewUrl} target="_blank" rel="noreferrer" key={item.id}>{row}</a> : <div className="project-row" key={item.id}>{row}</div>;
            }) : <p className="empty-list">保存第一条完整需求后会显示在这里。</p>}
          </div>
        </aside>
      ) : null}

      {sheet === "workflow" ? (
        <aside className="bottom-sheet detail-sheet workflow-sheet">
          <div className="sheet-handle" />
          <div className="sheet-title"><div><p className="eyebrow">DELIVERY PIPELINE</p><h3>真实执行链路</h3></div><button onClick={() => setSheet(null)}><Icon name="x" /></button></div>
          <div className="workflow-list">{WORKFLOW.map(([number, title, detail]) => <div key={number}><span>{number}</span><section><strong>{title}</strong><p>{detail}</p></section></div>)}</div>
          <p className="workflow-boundary">当前完成的是需求收集、Mobile Spec 通用化与本机单任务入口；协调服务、事件流、云 Runner 和 DeploymentProvider 仍需按 WBS 实现。</p>
        </aside>
      ) : null}
    </main>
  );
}
