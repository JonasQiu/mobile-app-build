"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { PREVIEW_CANVASES, previewIndexAfterMove, sanitizeReviewSvg } from "./lib/preview-ui.mjs";

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
  executionEvents?: Array<{ id?: string; at?: string; message?: string; stage?: string; kind?: string; progress?: number }>;
  executionCheckpoints?: ExecutionStage[];
  previewApprovalStatus?: "pending" | "approved" | null;
  selectedPreviewId?: string | null;
};

type ExecutionCapacity = { active: number; max: number };
type ExecutionMode = "continue" | "rerun" | "step";
type ExecutionStage = "mobile-spec" | "preview" | "implementation" | "build" | "deployment";
type ExecutionAction = { mode: ExecutionMode; targetStage?: ExecutionStage; regeneratePreview?: boolean };
type ArtifactFile = { name: string; label: string; description?: string; id?: string; setId?: string; format: "markdown" | "json" | "text" | "svg"; content: string };
type ArtifactResponse = { stage: ExecutionStage; checkpointed: boolean; artifacts: ArtifactFile[] };
type PreviewDevice = "desktop" | "tablet" | "mobile";
type PreviewImageStatus = "loading" | "ready" | "failed";

const POLL_INTERVAL_MS = 15_000;
const PREVIEW_FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const PREVIEW_DISCLAIMER = "评审图不是最终页面；设备画布仅为尺寸模拟，不代表真实设备或最终实现。";
const LOCAL_RUNNER_RECOVERY_URL = "http://127.0.0.1:5174/control-endpoint/rotate";
const RECOVERABLE_RUNNER_CODES = new Set([
  "EXECUTOR_OFFLINE",
  "EXECUTOR_CONFIG_INVALID",
  "EXECUTOR_UNHEALTHY",
  "EXECUTOR_UNREACHABLE",
]);

const EXAMPLES = [
  "做一个极简的个人记账网站，可按月份查看支出",
  "做一个活动报名页，带人数统计和移动端分享",
  "做一个之前没有预设过的业务网站",
];

const WORKFLOW = [
  ["01", "需求输入", "保留完整文本，可同时补充公开链接或文档链接"],
  ["02", "Mobile Spec", "生成 Proposal、Specs、Design、Review 与 Tasks，并通过门禁"],
  ["03", "多图预览", "基于需求与规格生成 3 份视觉方向，只生成评审图，不写正式网站源码"],
  ["04", "用户确认", "选择满意方案；未确认时服务端禁止进入 Codex"],
  ["05", "Codex 实现", "Codex 依据原始需求、Mobile Spec 和已确认方向编写项目代码"],
  ["06", "构建验证", "执行依赖锁定安装、测试、独立 Verify 与生产构建"],
  ["07", "部署结束", "部署独立站点；健康检查通过后返回外部 HTTPS URL"],
];

const STAGE_LABELS: Record<string, string> = {
  requirement: "需求已入队",
  "mobile-spec": "正在生成并验证 Mobile Spec",
  preview: "正在生成多方案预览",
  implementation: "Codex 正在实现页面",
  build: "正在测试与生产构建",
  deployment: "正在部署并执行健康检查",
  delivered: "部署完成",
  paused: "执行已暂停",
  awaiting_approval: "预览已就绪，等待确认",
};

const STAGES = [
  { key: "requirement", label: "需求", detail: "需求已保存" },
  { key: "mobile-spec", label: "Mobile Spec", detail: "规格与门禁" },
  { key: "preview", label: "预览", detail: "多图确认" },
  { key: "implementation", label: "Codex", detail: "页面实现" },
  { key: "build", label: "构建", detail: "生产验证" },
  { key: "deployment", label: "部署", detail: "发布与检查" },
  { key: "delivered", label: "完成", detail: "返回 URL" },
];

const EXECUTION_STAGES: ExecutionStage[] = ["mobile-spec", "preview", "implementation", "build", "deployment"];
const QUICK_ACTIONS: Array<{ label: string; mode: ExecutionMode; targetStage?: ExecutionStage }> = [
  { label: "继续", mode: "continue" },
  { label: "重跑", mode: "rerun" },
  { label: "规格", mode: "step", targetStage: "mobile-spec" },
  { label: "预览", mode: "step", targetStage: "preview" },
  { label: "实现", mode: "step", targetStage: "implementation" },
  { label: "构建", mode: "step", targetStage: "build" },
  { label: "部署", mode: "step", targetStage: "deployment" },
];

function stageIndex(stage: string | null) {
  if (stage === "failed" || stage === "paused") return -1;
  return Math.max(0, STAGES.findIndex((item) => item.key === stage));
}

function formatEventTime(value?: string) {
  if (!value) return "刚刚";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "刚刚" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function nextExecutionStage(project?: ProjectRecord | null): ExecutionStage {
  const completed = new Set(project?.executionCheckpoints || []);
  return EXECUTION_STAGES.find((stage) => !completed.has(stage)) || "deployment";
}

function inlineMarkdown(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return tokens.filter(Boolean).map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**")) return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("`") && token.endsWith("`")) return <code key={index}>{token.slice(1, -1)}</code>;
    const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return token;
  });
}

function MarkdownPreview({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      index += 1;
      blocks.push(<pre key={`code-${index}`} data-language={language || undefined}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      blocks.push(<Tag key={`heading-${index}`}>{inlineMarkdown(heading[2])}</Tag>);
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) items.push(lines[index++].replace(/^[-*]\s+/, ""));
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\d+\.\s+/, ""));
      blocks.push(<ol key={`ordered-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ol>);
      continue;
    }
    if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].startsWith("> ")) quote.push(lines[index++].slice(2));
      blocks.push(<blockquote key={`quote-${index}`}>{inlineMarkdown(quote.join(" "))}</blockquote>);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={`rule-${index}`} />);
      index += 1;
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s|^```|^[-*]\s+|^\d+\.\s+|^>\s|^---+$/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }
  return <div className="markdown-preview">{blocks}</div>;
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

function Icon({ name }: { name: "menu" | "spark" | "send" | "chevron" | "x" | "plus" | "logout" | "external" | "trash" | "pause" | "refresh" | "expand" }) {
  const glyphs = { menu: "☰", spark: "✦", send: "↑", chevron: "›", x: "×", plus: "+", logout: "↪", external: "↗", trash: "⌫", pause: "Ⅱ", refresh: "↻", expand: "⛶" };
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

function svgDataUrl(content: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
}

function PreviewImage({ artifact, onError, onLoad }: { artifact: ArtifactFile; onError?: () => void; onLoad?: () => void }) {
  // Runtime-generated SVG review artifacts are already sized and cannot use a static Next image loader.
  const safeSvg = sanitizeReviewSvg(artifact.content);
  if (!safeSvg) return <div className="preview-image-failure" role="img" aria-label={`${artifact.label}预览不可用`}>安全检查未通过</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={svgDataUrl(safeSvg)} alt={`${artifact.label}网站预览图`} onError={onError} onLoad={onLoad} />;
}

export function MobileBuildApp() {
  const [authState, setAuthState] = useState<"checking" | "signed-out" | "signed-in">("checking");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [prompt, setPrompt] = useState("");
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [executionCapacity, setExecutionCapacity] = useState<ExecutionCapacity>({ active: 0, max: 2 });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [sheet, setSheet] = useState<null | "menu" | "workflow" | "artifacts">(null);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [genProgress, setGenProgress] = useState("");
  const [genError, setGenError] = useState("");
  const [runnerIssueCode, setRunnerIssueCode] = useState("");
  const [repairingRunner, setRepairingRunner] = useState(false);
  const [lastExecutionAction, setLastExecutionAction] = useState<ExecutionAction>({ mode: "continue" });
  const [previewUrl, setPreviewUrl] = useState("");
  const [deletingProjectId, setDeletingProjectId] = useState("");
  const [pausingProjectId, setPausingProjectId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [artifactStage, setArtifactStage] = useState<ExecutionStage>("mobile-spec");
  const [artifactData, setArtifactData] = useState<ArtifactResponse | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState("");
  const [activeArtifactName, setActiveArtifactName] = useState("");
  const [previewOptions, setPreviewOptions] = useState<ArtifactFile[]>([]);
  const [previewProjectId, setPreviewProjectId] = useState("");
  const [selectedPreviewId, setSelectedPreviewId] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [approvingPreview, setApprovingPreview] = useState(false);
  const [immersivePreviewId, setImmersivePreviewId] = useState("");
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
  const [previewImageStatus, setPreviewImageStatus] = useState<Record<string, PreviewImageStatus>>({});
  const [immersiveAnnouncement, setImmersiveAnnouncement] = useState("");
  const applicationContentRef = useRef<HTMLDivElement | null>(null);
  const previewDialogRef = useRef<HTMLDivElement | null>(null);
  const previewCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeProject = projects.find((item) => item.id === activeProjectId) ?? null;
  const generating = ["dispatching", "building"].includes(activeProject?.status || "");
  const hasActiveProjects = projects.some((item) => ["dispatching", "building"].includes(item.status));
  const immersivePreviewOpen = Boolean(immersivePreviewId);

  const loadPreviewOptions = useCallback(async (projectId: string, preferredId = "") => {
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/artifacts/preview`, {
        headers: { accept: "application/json" },
      });
      const data = await readJsonResponse<ArtifactResponse & { error?: string }>(response, "读取预览方案失败");
      if (!response.ok || !data.checkpointed || !data.artifacts?.length) throw new Error(data.error || "预览方案尚未生成");
      const options = data.artifacts.filter((artifact) => artifact.format === "svg" && artifact.id);
      if (options.length !== 3) throw new Error("当前批次必须恰好包含 3 个预览方向，请点击“换一组”重新生成");
      setPreviewOptions(options);
      const preferred = options.find((item) => item.id === preferredId);
      setSelectedPreviewId(preferred && sanitizeReviewSvg(preferred.content) ? preferredId : "");
      setPreviewImageStatus(Object.fromEntries(options.map((option) => [
        option.id || option.name,
        sanitizeReviewSvg(option.content) ? "loading" : "failed",
      ])));
      setImmersivePreviewId("");
      setPreviewProjectId(projectId);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "读取预览方案失败");
    } finally {
      setPreviewLoading(false);
    }
  }, []);

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
        ? readJsonResponse<{ projects: ProjectRecord[]; executionCapacity?: ExecutionCapacity }>(response, "无法读取项目")
        : { projects: [], executionCapacity: { active: 0, max: 2 } })
      .then((data) => {
        setProjects(data.projects ?? []);
        if (data.executionCapacity) setExecutionCapacity(data.executionCapacity);
      })
      .catch(() => setProjects([]));
  }, [authState]);

  useEffect(() => {
    if (authState !== "signed-in" || !hasActiveProjects) return;
    let cancelled = false;
    const sync = async () => {
      try {
        const response = await fetch("/api/projects", { headers: { accept: "application/json" } });
        const snapshot = await readJsonResponse<{ projects?: ProjectRecord[]; executionCapacity?: ExecutionCapacity; error?: string }>(response, "读取执行状态失败");
        if (!response.ok) throw new Error(snapshot.error || "读取执行状态失败");
        if (cancelled) return;
        const items = snapshot.projects ?? [];
        setProjects(items);
        if (snapshot.executionCapacity) setExecutionCapacity(snapshot.executionCapacity);
      } catch (error) {
        if (!cancelled) setGenError(error instanceof Error ? error.message : "读取执行状态失败");
      }
    };
    const timer = window.setInterval(() => void sync(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authState, hasActiveProjects]);

  useEffect(() => {
    const hasPreview = activeProject?.executionCheckpoints?.includes("preview")
      || activeProject?.status === "awaiting_approval"
      || activeProject?.currentStage === "preview";
    if (!activeProjectId || !hasPreview || previewProjectId === activeProjectId) return;
    const timer = window.setTimeout(() => void loadPreviewOptions(activeProjectId, activeProject?.selectedPreviewId || ""), 0);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, activeProject?.currentStage, activeProject?.selectedPreviewId, activeProject?.status, activeProject?.executionCheckpoints, previewProjectId, loadPreviewOptions]);

  const closeImmersivePreview = useCallback(() => {
    const trigger = previewTriggerRef.current;
    setImmersivePreviewId("");
    setImmersiveAnnouncement("");
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  }, []);

  const moveImmersivePreview = useCallback((direction: number) => {
    const currentIndex = previewOptions.findIndex((option) => option.id === immersivePreviewId);
    const nextIndex = previewIndexAfterMove(currentIndex, direction, previewOptions.length);
    if (nextIndex < 0 || nextIndex === currentIndex) {
      setImmersiveAnnouncement(direction < 0 ? "已经是第一个方向" : "已经是最后一个方向");
      return;
    }
    const next = previewOptions[nextIndex];
    setImmersivePreviewId(next.id || "");
    setImmersiveAnnouncement(`已切换到方向 ${nextIndex + 1}，${next.label}`);
  }, [immersivePreviewId, previewOptions]);

  useEffect(() => {
    if (!immersivePreviewOpen) return;
    const content = applicationContentRef.current;
    const previousOverflow = document.body.style.overflow;
    content?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => previewCloseButtonRef.current?.focus());
    return () => {
      content?.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
    };
  }, [immersivePreviewOpen]);

  useEffect(() => {
    if (!immersivePreviewId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const isTextEntry = target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName || "");
      if (event.key === "Escape") {
        event.preventDefault();
        closeImmersivePreview();
        return;
      }
      if (!isTextEntry && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        moveImmersivePreview(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(previewDialogRef.current?.querySelectorAll<HTMLElement>(PREVIEW_FOCUSABLE) || []);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeImmersivePreview, immersivePreviewId, moveImmersivePreview]);

  function openImmersivePreview(option: ArtifactFile, trigger: HTMLButtonElement) {
    const optionId = option.id || "";
    if (!optionId) return;
    previewTriggerRef.current = trigger;
    setPreviewDevice("desktop");
    setImmersivePreviewId(optionId);
    setImmersiveAnnouncement(`已打开方向 ${previewOptions.findIndex((item) => item.id === optionId) + 1}，${option.label}，桌面画布`);
  }

  function selectPreview(option: ArtifactFile) {
    const optionId = option.id || "";
    if (!optionId || previewImageStatus[optionId] === "failed" || !sanitizeReviewSvg(option.content)) return;
    setSelectedPreviewId(optionId);
    setImmersiveAnnouncement(`已选择${option.label}，尚未最终确认生成`);
  }

  function updatePreviewImageStatus(optionId: string, status: PreviewImageStatus) {
    setPreviewImageStatus((current) => current[optionId] === status ? current : { ...current, [optionId]: status });
    if (status === "failed") {
      setSelectedPreviewId((current) => current === optionId ? "" : current);
      setImmersiveAnnouncement("当前方向载入失败，选择已清除，仍可切换其他方向");
    }
    if (status === "ready" && optionId === immersivePreviewId) setImmersiveAnnouncement("当前方向已载入");
  }

  function handleLogout() {
    window.location.assign("/signout-with-chatgpt?return_to=/");
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
      setPreviewOptions([]);
      setPreviewProjectId("");
      setSelectedPreviewId("");
      setImmersivePreviewId("");
      setPreviewImageStatus({});
      setPreviewError("");
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
    setGenProgress("");
    setGenError("");
    setPreviewUrl("");
    setPreviewOptions([]);
    setPreviewProjectId("");
    setSelectedPreviewId("");
    setImmersivePreviewId("");
    setPreviewImageStatus({});
    setPreviewError("");
  }

  function openProject(item: ProjectRecord) {
    if (item.id !== activeProjectId) {
      setPreviewOptions([]);
      setPreviewProjectId("");
      setSelectedPreviewId(item.selectedPreviewId || "");
      setImmersivePreviewId("");
      setPreviewImageStatus({});
      setPreviewError("");
    }
    setActiveProjectId(item.id);
    setSubmittedPrompt(item.prompt);
    setPreviewUrl(isExternalDeliveryUrl(item.previewUrl) ? item.previewUrl : "");
    setGenError(item.status === "failed" ? item.executionMessage || "该任务执行失败，可重新发起构建。" : "");
    setGenProgress(item.executionMessage || STAGE_LABELS[item.currentStage || ""] || item.status);
    setSheet(null);
  }

  async function deleteProject(item: ProjectRecord) {
    if (["dispatching", "building"].includes(item.status) || deletingProjectId) return;
    if (!window.confirm(`确认删除“${item.name}”吗？删除后无法恢复。`)) return;
    setDeleteError("");
    setDeletingProjectId(item.id);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const data = await readJsonResponse<{ deleted?: boolean; error?: string }>(response, "删除项目失败");
      if (!response.ok || !data.deleted) throw new Error(data.error || "删除项目失败");
      setProjects((items) => items.filter((project) => project.id !== item.id));
      if (activeProjectId === item.id) resetRequest();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除项目失败");
    } finally {
      setDeletingProjectId("");
    }
  }

  async function runProject(projectId: string, action: ExecutionAction = { mode: "continue" }) {
    if (!projectId) return;
    setLastExecutionAction(action);
    setRunnerIssueCode("");
    const previousProject = projects.find((item) => item.id === projectId);
    const optimisticStage = action.targetStage || (action.mode === "rerun" ? "mobile-spec" : nextExecutionStage(previousProject));
    setGenError("");
    setGenProgress(action.mode === "step" ? `正在派发“${STAGE_LABELS[optimisticStage]}”单步任务…` : action.mode === "rerun" ? "正在派发完整重跑任务…" : "正在从成功检查点继续执行…");
    if (action.mode !== "continue") setPreviewUrl("");
    if (action.mode === "rerun" || action.regeneratePreview) {
      setPreviewOptions([]);
      setPreviewProjectId("");
      setSelectedPreviewId("");
      setImmersivePreviewId("");
      setPreviewImageStatus({});
      setPreviewError("");
    }
    setProjects((items) => items.map((item) => item.id === projectId ? {
      ...item,
      status: "dispatching",
      currentStage: optimisticStage,
      executionProgress: 2,
      executionMessage: "正在向受信任 Runner 派发任务",
      previewUrl: action.mode === "continue" ? item.previewUrl : null,
    } : item));
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `project-${projectId}-${Date.now()}` },
        body: JSON.stringify(action),
      });
      const data = await readJsonResponse<{ job?: { id: string; status?: string; stage?: string; currentStage?: string; url?: string; progress?: number; message?: string; checkpoints?: ExecutionStage[] }; error?: string; code?: string }>(response, "任务派发失败");
      if (!response.ok || !data.job) {
        setRunnerIssueCode(typeof data.code === "string" ? data.code : "");
        if (data.code !== "EXECUTOR_DISPATCH_UNKNOWN") {
          setProjects((items) => items.map((item) => item.id === projectId ? {
            ...(previousProject || item),
            status: previousProject?.status || "queued",
            currentStage: previousProject?.currentStage || "requirement",
            executionProgress: previousProject?.executionProgress || 0,
            executionMessage: previousProject?.executionMessage,
            previewUrl: previousProject?.previewUrl || null,
          } : item));
          if (previousProject && isExternalDeliveryUrl(previousProject.previewUrl)) setPreviewUrl(previousProject.previewUrl);
        }
        throw new Error(data.error || "Codex 任务派发失败");
      }

      if (data.job.status === "delivered" && isExternalDeliveryUrl(data.job.url || null)) {
        setPreviewUrl(data.job.url);
        setGenProgress(data.job.message || "全部步骤已成功，无需重复构建");
        setProjects((items) => items.map((item) => item.id === projectId ? {
          ...item,
          status: "delivered",
          currentStage: "delivered",
          executionProgress: 100,
          executionMessage: data.job?.message || "全部步骤已成功，无需重复构建",
          executionCheckpoints: data.job?.checkpoints || item.executionCheckpoints,
          previewUrl: data.job?.url || item.previewUrl,
        } : item));
        return;
      }

      if (data.job.status === "awaiting_approval") {
        setGenProgress(data.job.message || "预览已就绪，等待确认");
        setProjects((items) => items.map((item) => item.id === projectId ? {
          ...item,
          status: "awaiting_approval",
          currentStage: "preview",
          executionProgress: data.job?.progress || 56,
          executionMessage: data.job?.message || "预览已就绪，等待确认",
          executionCheckpoints: data.job?.checkpoints || item.executionCheckpoints,
          previewApprovalStatus: "pending",
          selectedPreviewId: null,
        } : item));
        setPreviewProjectId("");
        return;
      }

      if (!previousProject || !["dispatching", "building"].includes(previousProject.status)) {
        setExecutionCapacity((capacity) => ({ ...capacity, active: Math.min(capacity.max, capacity.active + 1) }));
      }
      setGenProgress("任务已进入云端执行队列…");
      setProjects((items) => items.map((item) => item.id === projectId ? {
        ...item,
        status: "building",
        currentStage: data.job?.currentStage || data.job?.stage || optimisticStage,
        executionProgress: 4,
        executionMessage: "任务已进入云端执行队列，等待下一次 15 秒同步",
        executionCheckpoints: data.job?.checkpoints || item.executionCheckpoints,
      } : item));
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      setGenError(message.length > 600 ? `${message.slice(0, 600)}…` : message);
    }
  }

  function handleGenerate() {
    void runProject(activeProjectId, { mode: "continue" });
  }

  async function approvePreview() {
    if (!activeProjectId || !selectedPreviewId || approvingPreview) return;
    const selected = previewOptions.find((option) => option.id === selectedPreviewId);
    if (!selected || !sanitizeReviewSvg(selected.content) || previewImageStatus[selectedPreviewId] !== "ready") {
      setPreviewError("所选方向尚未成功载入，请选择其他方向或稍后重试");
      return;
    }
    setApprovingPreview(true);
    setPreviewError("");
    setGenError("");
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(activeProjectId)}/preview-approval`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ previewId: selectedPreviewId }),
      });
      const data = await readJsonResponse<{ approved?: boolean; selectedPreviewId?: string; error?: string }>(response, "确认预览失败");
      if (!response.ok || !data.approved) throw new Error(data.error || "确认预览失败");
      setProjects((items) => items.map((item) => item.id === activeProjectId ? {
        ...item,
        status: "ready",
        currentStage: "preview",
        previewApprovalStatus: "approved",
        selectedPreviewId,
        executionMessage: "预览方案已确认，正在派发 Codex 实现",
      } : item));
      setGenProgress("预览方案已确认，正在派发 Codex 实现…");
      await runProject(activeProjectId, { mode: "continue" });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "确认预览失败");
    } finally {
      setApprovingPreview(false);
    }
  }

  function regeneratePreviews() {
    if (!activeProjectId || generating || approvingPreview) return;
    void runProject(activeProjectId, { mode: "step", targetStage: "preview", regeneratePreview: true });
  }

  async function repairRunnerConnection() {
    if (!activeProjectId || repairingRunner) return;
    setRepairingRunner(true);
    setGenError("");
    setGenProgress("正在检测 Runner 并请求自动更换连接地址…");
    try {
      const localResponse = await fetch(LOCAL_RUNNER_RECOVERY_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}",
      });
      const local = await readJsonResponse<{ endpoint?: string; instanceId?: string; error?: string }>(localResponse, "本机 Runner 连接失败");
      if (!localResponse.ok || !local.endpoint || !local.instanceId) {
        throw new Error(local.error || "本机 Runner 未返回新的连接地址");
      }
      setGenProgress("新地址已创建，正在进行服务端健康检查…");
      const response = await fetch("/api/v1/runner/recover", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ endpoint: local.endpoint, instanceId: local.instanceId }),
      });
      const recovered = await readJsonResponse<{ online?: boolean; error?: string }>(response, "连接修复失败");
      if (!response.ok || !recovered.online) throw new Error(recovered.error || "连接修复失败");
      setRunnerIssueCode("");
      setGenProgress("Runner 新连接已恢复，正在重新派发原任务…");
      await runProject(activeProjectId, lastExecutionAction);
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接修复失败";
      setGenError(message.includes("fetch") ? "无法连接本机 Runner，请确认 Runner 服务正在当前设备运行后再试" : message);
    } finally {
      setRepairingRunner(false);
    }
  }

  async function openArtifacts(stage: ExecutionStage) {
    if (!activeProjectId) return;
    setArtifactStage(stage);
    setArtifactData(null);
    setArtifactError("");
    setActiveArtifactName("");
    setArtifactLoading(true);
    setSheet("artifacts");
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(activeProjectId)}/artifacts/${encodeURIComponent(stage)}`, {
        headers: { accept: "application/json" },
      });
      const data = await readJsonResponse<ArtifactResponse & { error?: string }>(response, "读取步骤产物失败");
      if (!response.ok) throw new Error(data.error || "读取步骤产物失败");
      setArtifactData(data);
      setActiveArtifactName(data.artifacts?.[0]?.name || "");
    } catch (error) {
      setArtifactError(error instanceof Error ? error.message : "读取步骤产物失败");
    } finally {
      setArtifactLoading(false);
    }
  }

  async function pauseProject(projectId: string) {
    if (!projectId || pausingProjectId || activeProject?.status !== "building") return;
    setGenError("");
    setPausingProjectId(projectId);
    setGenProgress("正在停止当前执行阶段…");
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/pause`, { method: "POST" });
      const data = await readJsonResponse<{ project?: { status: string; currentStage: string }; executionCapacity?: ExecutionCapacity; error?: string }>(response, "暂停任务失败");
      if (!response.ok || data.project?.status !== "paused") throw new Error(data.error || "Runner 未确认暂停");
      setProjects((items) => items.map((item) => item.id === projectId ? {
        ...item,
        status: "paused",
        currentStage: "paused",
        previewUrl: null,
        executionMessage: "执行已暂停，可从成功检查点继续",
        executionEvents: [
          ...(item.executionEvents || []),
          { id: `paused-${Date.now()}`, at: new Date().toISOString(), stage: "paused", kind: "warning", message: "执行已暂停，可从成功检查点继续", progress: item.executionProgress || 0 },
        ].slice(-12),
      } : item));
      if (data.executionCapacity) setExecutionCapacity(data.executionCapacity);
      setGenProgress("执行已暂停，可从成功检查点继续");
    } catch (error) {
      setGenError(error instanceof Error ? error.message : "暂停任务失败");
    } finally {
      setPausingProjectId("");
    }
  }

  const deliveryUrl = isExternalDeliveryUrl(activeProject?.previewUrl || null) ? activeProject.previewUrl : previewUrl;
  const currentStageIndex = stageIndex(activeProject?.currentStage || (deliveryUrl ? "delivered" : "requirement"));
  const progressValue = activeProject?.status === "delivered"
    ? 100
    : Math.max(0, Math.min(99, activeProject?.executionProgress ?? (generating ? 5 : 0)));
  const liveMessage = activeProject?.executionMessage || genProgress || (deliveryUrl ? "部署和健康检查均已通过" : "等待开始真实构建");
  const liveEvents = activeProject?.executionEvents?.filter((event) => event.message).slice(-6).reverse() ?? [];
  const capacityFull = executionCapacity.active >= executionCapacity.max;
  const runnerRecoverable = RECOVERABLE_RUNNER_CODES.has(runnerIssueCode);
  const activeArtifact = artifactData?.artifacts.find((artifact) => artifact.name === activeArtifactName) || artifactData?.artifacts[0] || null;
  const immersivePreviewIndex = previewOptions.findIndex((option) => option.id === immersivePreviewId);
  const immersivePreview = immersivePreviewIndex >= 0 ? previewOptions[immersivePreviewIndex] : null;
  const activePreviewCanvas = PREVIEW_CANVASES.find((canvas) => canvas.id === previewDevice) || PREVIEW_CANVASES[0];
  const immersivePreviewSafe = immersivePreview ? Boolean(sanitizeReviewSvg(immersivePreview.content)) : false;
  const immersivePreviewStatus = immersivePreview
    ? previewImageStatus[immersivePreview.id || immersivePreview.name] || (immersivePreviewSafe ? "loading" : "failed")
    : "failed";
  const selectedPreview = previewOptions.find((option) => option.id === selectedPreviewId) || null;
  const selectedPreviewReady = Boolean(selectedPreview
    && sanitizeReviewSvg(selectedPreview.content)
    && previewImageStatus[selectedPreviewId] === "ready");

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
          <div className="login-form">
            <p className="auth-copy">使用你的 ChatGPT 账号登录。账号只用于身份识别和数据隔离，构建能力由 SiteForge 统一提供。</p>
            <a className="primary-button login-button" href="/signin-with-chatgpt?return_to=%2F">使用 ChatGPT 登录<Icon name="chevron" /></a>
          </div>
          <p className="auth-note"><span className="status-dot" />每位用户只能查看自己的需求与产物</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div ref={applicationContentRef} className="app-content">
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
              <div><p className="agent-label">{activeProject ? activeProject.name : "需求已保存"}</p><p>{activeProject?.status === "delivered" ? "该项目已完成；继续执行会复用全部成功步骤，重跑才会清除检查点。" : activeProject?.status === "awaiting_approval" ? "已生成多份需求专属预览。选择并确认前，不会调用 Codex 或构建正式网站。" : activeProject?.status === "ready" ? "指定步骤已完成，产物已保存；可以继续下一步或单独查看文档。" : activeProject?.status === "paused" ? "执行已暂停；继续会从已有成功检查点往后运行。" : ["dispatching", "building"].includes(activeProject?.status || "") ? "该项目正在真实执行，下面会每 15 秒同步进度与消息。" : "已原样保存，没有关键词分类或模板替换。"}</p></div>
            </div>
            <article className="plan-card scope-card">
              <div className="plan-head"><div><span>项目执行</span><h3>{activeProject?.status === "delivered" ? "交付完成" : activeProject?.status === "awaiting_approval" ? "等待预览确认" : activeProject?.status === "ready" ? "步骤完成" : activeProject?.status === "failed" ? "执行失败" : activeProject?.status === "paused" ? "执行已暂停" : generating ? "正在构建" : "准备执行"}</h3></div><span className={`version-pill ${activeProject?.status === "failed" ? "failed" : activeProject?.status === "paused" ? "paused" : ""}`}>{progressValue}%</span></div>
              <div className="live-progress" aria-label={`执行进度 ${progressValue}%`}><span style={{ width: `${progressValue}%` }} /></div>
              <div className="stage-grid">
                {STAGES.map((stage, index) => {
                  const artifactStageKey = EXECUTION_STAGES.includes(stage.key as ExecutionStage) ? stage.key as ExecutionStage : null;
                  const checkpointDone = artifactStageKey && activeProject?.executionCheckpoints?.includes(artifactStageKey);
                  const done = stage.key === "requirement" || activeProject?.status === "delivered" || Boolean(checkpointDone)
                    || (!activeProject?.executionCheckpoints?.length && (index < currentStageIndex || (activeProject?.status === "ready" && index === currentStageIndex)));
                  const running = generating && index === currentStageIndex;
                  const content = <><i>{done ? "✓" : index + 1}</i><span><strong>{stage.label}</strong><small>{stage.detail}</small></span>{artifactStageKey ? <em>查看</em> : null}</>;
                  return artifactStageKey
                    ? <button type="button" className={`stage-step inspectable ${done ? "done" : ""} ${running ? "running" : ""}`} key={stage.key} onClick={() => void openArtifacts(artifactStageKey)}>{content}</button>
                    : <div className={`stage-step ${done ? "done" : ""} ${running ? "running" : ""}`} key={stage.key}>{content}</div>;
                })}
              </div>
              {activeProject?.status === "awaiting_approval" ? (
                <section className="preview-approval" aria-label="网站预览方案确认">
                  <header><div><span>PREVIEW GATE</span><strong>选择一份方向，再生成网站</strong></div><small>{previewOptions.length ? `${previewOptions.length} 个方案` : "正在读取"}</small></header>
                  <p>这些是基于本次需求和 Mobile Spec 生成的视觉评审图，不是最终页面。确认后才会进入 Codex。</p>
                  {previewLoading ? <div className="preview-loading"><i className="status-dot" />正在读取多张预览图…</div> : null}
                  {previewError ? <p className="preview-error" role="alert">{previewError}</p> : null}
                  {previewOptions.length ? <div className="preview-option-grid">
                    {previewOptions.map((option, index) => {
                      const optionId = option.id || option.name;
                      const safe = Boolean(sanitizeReviewSvg(option.content));
                      const imageStatus = previewImageStatus[optionId] || (safe ? "loading" : "failed");
                      const unavailable = !safe || imageStatus === "failed";
                      const selected = option.id === selectedPreviewId;
                      return <article className={`preview-option ${selected ? "selected" : ""} ${unavailable ? "failed" : ""}`} key={optionId}>
                        <div className="preview-option-image">
                          <PreviewImage artifact={option} onLoad={() => updatePreviewImageStatus(optionId, "ready")} onError={() => updatePreviewImageStatus(optionId, "failed")} />
                          {imageStatus === "loading" ? <span><i className="status-dot" />正在载入方向 {index + 1}…</span> : null}
                        </div>
                        <div className="preview-option-copy"><span><i>{selected ? "✓" : index + 1}</i><b>{option.label}</b></span><small>{option.description}</small></div>
                        {unavailable ? <p role="status">该方向无法安全载入，不能选择</p> : null}
                        <div className="preview-option-actions">
                          <button type="button" onClick={(event) => openImmersivePreview(option, event.currentTarget)}>沉浸预览<Icon name="expand" /></button>
                          <button type="button" aria-pressed={selected} disabled={unavailable || imageStatus === "loading"} onClick={() => selectPreview(option)}>{selected ? "已选择" : "选择此方案"}</button>
                        </div>
                      </article>;
                    })}
                  </div> : null}
                  <div className="preview-actions"><button type="button" className="secondary-button" disabled={previewLoading || approvingPreview} onClick={regeneratePreviews}>换一组<Icon name="refresh" /></button><button type="button" className="primary-button" disabled={!selectedPreviewReady || previewLoading || approvingPreview} onClick={() => void approvePreview()}>{approvingPreview ? "确认中…" : "确认生成"}<Icon name="spark" /></button></div>
                  {!immersivePreviewOpen ? <p className="sr-only" aria-live="polite">{immersiveAnnouncement}</p> : null}
                </section>
              ) : null}
              <section className="live-console" aria-live="polite">
                <div className="console-head"><span><i className={generating ? "status-dot" : "status-dot quiet"} />实时消息</span><small>{["dispatching", "building"].includes(activeProject?.status || "") ? "每 15 秒同步" : "最后状态"}</small></div>
                <p className="console-current">{liveMessage}</p>
                {liveEvents.length ? <ol>{liveEvents.map((event, index) => <li className={event.kind === "warning" ? "warning" : ""} key={event.id || `${event.at}-${index}`}><time>{formatEventTime(event.at)}</time><span><b>{STAGE_LABELS[event.stage || ""] || event.stage || "执行器"}</b>{event.message}</span></li>)}</ol> : <p className="console-empty">开始执行后，这里会展示 Mobile Spec 门禁、Codex 源码生成、文件写入、构建修复和部署健康检查的真实消息。</p>}
              </section>
              {genError ? <div className="runner-error-panel"><pre className="gen-error" role="alert">{genError}</pre>{runnerRecoverable ? <button className="repair-runner-button" type="button" disabled={repairingRunner} onClick={() => void repairRunnerConnection()}>{repairingRunner ? "修复中…" : "修复连接"}<Icon name="refresh" /></button> : null}</div> : null}
              <div className="plan-actions">
                {generating ? <button className="primary-button pause-button" onClick={() => void pauseProject(activeProjectId)} disabled={activeProject?.status !== "building" || pausingProjectId === activeProjectId}>{activeProject?.status === "dispatching" ? "正在派发" : pausingProjectId === activeProjectId ? "暂停中…" : "暂停执行"}<Icon name="pause" /></button> : null}
                {!generating && deliveryUrl ? <a className="primary-button" href={deliveryUrl} target="_blank" rel="noreferrer">打开交付页面<Icon name="external" /></a> : null}
                {!generating && activeProject?.status !== "awaiting_approval" ? <button className="primary-button" onClick={handleGenerate} disabled={!submittedPrompt || !activeProjectId || capacityFull}>{["ready", "paused", "failed", "delivered"].includes(activeProject?.status || "") ? "继续执行" : "开始真实构建"}<Icon name={["ready", "paused", "failed", "delivered"].includes(activeProject?.status || "") ? "refresh" : "spark"} /></button> : null}
                <button className="secondary-button" onClick={() => setSheet("workflow")}>流程说明<Icon name="chevron" /></button>
              </div>
            </article>
          </div>
        )}
      </section>

      <form className="composer" onSubmit={handlePrompt}>
        <div className="quick-actions" aria-label="执行快捷操作">
          {QUICK_ACTIONS.map((action) => <button
            type="button"
            key={`${action.mode}-${action.targetStage || "all"}`}
            disabled={!activeProjectId || generating || activeProject?.status === "awaiting_approval" || capacityFull}
            title={action.mode === "step" ? `只执行${action.label}步骤` : action.mode === "rerun" ? "清除检查点并完整重跑" : "复用成功步骤继续执行"}
            onClick={() => void runProject(activeProjectId, action)}
          >{action.label}</button>)}
        </div>
        <div className="composer-inner"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={capacityFull ? "已有 2 个需求执行中，请等待完成…" : "输入完整需求；可同时粘贴相关链接…"} rows={1} aria-label="项目需求" disabled={capacityFull} /><button type="submit" disabled={!prompt.trim() || saving || capacityFull} aria-label="保存需求"><Icon name="send" /></button></div>
        <div className="composer-meta"><span><i className="status-dot" />{saving ? "正在保存" : `只保存原始需求 · 执行中 ${executionCapacity.active}/${executionCapacity.max}`}</span><span>{saveError || (capacityFull ? "达到并发上限" : "不会匹配模板")}</span></div>
      </form>

      {sheet ? <button className="sheet-backdrop" aria-label="关闭面板" onClick={() => setSheet(null)} /> : null}
      {sheet === "menu" ? (
        <aside className="bottom-sheet menu-sheet">
          <div className="sheet-handle" />
          <div className="sheet-title"><div><p className="eyebrow">WORKSPACE</p><h3>需求与账户</h3></div><button onClick={() => setSheet(null)}><Icon name="x" /></button></div>
          <div className="account-row"><div className="account-avatar">{user?.username.slice(0, 1).toUpperCase() || "U"}</div><div><strong>{user?.username}</strong><span>ChatGPT 账户</span></div><button aria-label="退出登录" onClick={handleLogout}><Icon name="logout" /></button></div>
          <div className="recent-projects">
            <div className="list-heading"><span>已保存需求</span><small>{executionCapacity.active}/{executionCapacity.max} 执行中 · 共 {projects.length}</small></div>
            {deleteError ? <p className="history-error" role="alert">{deleteError}</p> : null}
            {projects.length ? projects.slice(0, 12).map((item) => <div className={`project-row ${item.id === activeProjectId ? "active" : ""}`} key={item.id}><button className="project-open" type="button" onClick={() => openProject(item)}><span>{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><small>{item.executionMessage || (isExternalDeliveryUrl(item.previewUrl) ? "已交付 · 点击查看详情" : STAGE_LABELS[item.currentStage || ""] || item.status)}</small></div></button><button className="project-delete" type="button" disabled={["dispatching", "building"].includes(item.status) || deletingProjectId === item.id} onClick={() => void deleteProject(item)} aria-label={`删除项目 ${item.name}`} title={["dispatching", "building"].includes(item.status) ? "进行中的需求不能删除" : "删除历史记录"}><Icon name="trash" /></button></div>) : <p className="empty-list">保存第一条完整需求后会显示在这里。</p>}
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

      {sheet === "artifacts" ? (
        <aside className="bottom-sheet artifact-sheet">
          <div className="sheet-handle" />
          <div className="sheet-title"><div><p className="eyebrow">STEP ARTIFACTS</p><h3>{STAGE_LABELS[artifactStage]} · 产物预览</h3></div><button onClick={() => setSheet(null)}><Icon name="x" /></button></div>
          {artifactLoading ? <div className="artifact-state"><i className="status-dot" />正在读取真实产物…</div> : null}
          {artifactError ? <p className="artifact-error" role="alert">{artifactError}</p> : null}
          {!artifactLoading && !artifactError && !artifactData?.checkpointed ? <div className="artifact-empty"><strong>该步骤还没有成功产物</strong><p>可点击输入框上方对应的单步按钮执行，成功后这里会出现可查看文件。</p></div> : null}
          {artifactData?.artifacts.length ? (
            <>
              <div className="artifact-tabs" role="tablist" aria-label="产物文件">
                {artifactData.artifacts.map((artifact) => <button type="button" role="tab" aria-selected={artifact.name === activeArtifact?.name} className={artifact.name === activeArtifact?.name ? "active" : ""} key={artifact.name} onClick={() => setActiveArtifactName(artifact.name)}><strong>{artifact.label}</strong><small>{artifact.name}</small></button>)}
              </div>
              <article className={`artifact-preview ${activeArtifact?.format || "text"}`}>
                <header><span>{activeArtifact?.name}</span><small>{activeArtifact?.format === "markdown" ? "Markdown 预览" : activeArtifact?.format === "svg" ? "视觉预览" : activeArtifact?.format === "json" ? "JSON 产物" : "日志文本"}</small></header>
                {activeArtifact?.format === "markdown" ? <MarkdownPreview content={activeArtifact.content} /> : activeArtifact?.format === "svg" ? <PreviewImage artifact={activeArtifact} /> : <pre><code>{activeArtifact?.content}</code></pre>}
              </article>
            </>
          ) : null}
        </aside>
      ) : null}
      </div>

      {immersivePreview ? (
        <div className="immersive-preview-layer">
          <div
            ref={previewDialogRef}
            className="immersive-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="immersive-preview-title"
            aria-describedby="immersive-preview-description immersive-preview-disclaimer"
          >
            <header className="immersive-preview-header">
              <div><p className="eyebrow">IMMERSIVE PREVIEW</p><h2 id="immersive-preview-title">{immersivePreview.label}</h2><p id="immersive-preview-description">{immersivePreview.description || "查看当前方向的构图与信息层级"}</p></div>
              <div className="immersive-preview-identity"><span>{immersivePreviewIndex + 1}/{previewOptions.length}</span><button ref={previewCloseButtonRef} type="button" aria-label="关闭沉浸预览" onClick={closeImmersivePreview}><Icon name="x" /></button></div>
            </header>

            <p id="immersive-preview-disclaimer" className="immersive-preview-disclaimer">{PREVIEW_DISCLAIMER}</p>

            <div className="preview-device-controls" role="group" aria-label="模拟设备画布">
              {PREVIEW_CANVASES.map((canvas) => <button
                type="button"
                key={canvas.id}
                aria-pressed={previewDevice === canvas.id}
                onClick={() => {
                  setPreviewDevice(canvas.id);
                  setImmersiveAnnouncement(`已切换到${canvas.label}模拟画布，${canvas.width} × ${canvas.height}`);
                }}
              ><span>{canvas.label}</span><small>{canvas.width} × {canvas.height}</small></button>)}
            </div>

            <div className="immersive-preview-stage" aria-busy={immersivePreviewStatus === "loading"}>
              <div className={`preview-device-canvas preview-device-${activePreviewCanvas.id}`} style={{ aspectRatio: `${activePreviewCanvas.width} / ${activePreviewCanvas.height}` }}>
                {immersivePreviewSafe ? <PreviewImage
                  key={immersivePreview.id || immersivePreview.name}
                  artifact={immersivePreview}
                  onLoad={() => updatePreviewImageStatus(immersivePreview.id || immersivePreview.name, "ready")}
                  onError={() => updatePreviewImageStatus(immersivePreview.id || immersivePreview.name, "failed")}
                /> : null}
                {immersivePreviewStatus === "loading" ? <div className="immersive-preview-state"><i className="status-dot" />正在载入 {immersivePreview.label}…</div> : null}
                {immersivePreviewStatus === "failed" ? <div className="immersive-preview-state failed" role="alert"><strong>该方向无法安全载入</strong><span>可以继续查看上一张或下一张；当前方向不能选择。</span></div> : null}
              </div>
              <p className="preview-canvas-caption">{activePreviewCanvas.label}模拟画布 · {activePreviewCanvas.width} × {activePreviewCanvas.height} · SVG 等比完整容纳</p>
            </div>

            <div className="immersive-preview-footer">
              <div className="immersive-preview-navigation" aria-label="切换预览方向">
                <button type="button" disabled={immersivePreviewIndex <= 0} onClick={() => moveImmersivePreview(-1)}>← 上一张</button>
                <span>{immersivePreview.label} · {immersivePreviewIndex + 1}/{previewOptions.length}</span>
                <button type="button" disabled={immersivePreviewIndex >= previewOptions.length - 1} onClick={() => moveImmersivePreview(1)}>下一张 →</button>
              </div>
              <button
                type="button"
                className={`immersive-preview-select ${selectedPreviewId === immersivePreview.id ? "selected" : ""}`}
                aria-pressed={selectedPreviewId === immersivePreview.id}
                disabled={!immersivePreviewSafe || immersivePreviewStatus !== "ready"}
                onClick={() => selectPreview(immersivePreview)}
              >{selectedPreviewId === immersivePreview.id ? "✓ 已选择，尚未最终确认" : "选择此方案"}</button>
            </div>
            <p className="sr-only" aria-live="polite" aria-atomic="true">{immersiveAnnouncement}</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
