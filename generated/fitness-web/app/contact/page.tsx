"use client";

import { FormEvent, useState } from "react";
import { courses, studioInfo } from "@/lib/data";

interface FormState {
  name: string;
  phone: string;
  course: string;
  time: string;
  note: string;
}

const initialForm: FormState = {
  name: "",
  phone: "",
  course: "",
  time: "",
  note: "",
};

const timeOptions = [
  "工作日上午 (09:00-12:00)",
  "工作日中午 (12:00-14:00)",
  "工作日晚上 (18:00-22:00)",
  "周末上午 (09:00-12:00)",
  "周末下午 (14:00-18:00)",
  "周末晚上 (18:00-22:00)",
];

export default function ContactPage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitted, setSubmitted] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(f: FormState) {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!f.name.trim()) e.name = "请填写姓名";
    if (!f.phone.trim()) {
      e.phone = "请填写手机号";
    } else if (!/^1[3-9]\d{9}$/.test(f.phone.trim())) {
      e.phone = "请输入有效的 11 位手机号";
    }
    if (!f.course) e.course = "请选择意向课程";
    if (!f.time) e.time = "请选择期望时间";
    return e;
  }

  function handleSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSubmitted(form);
  }

  function reset() {
    setForm(initialForm);
    setErrors({});
    setSubmitted(null);
  }

  return (
    <>
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-accent/10 via-zinc-950 to-zinc-950" />
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            BOOK A TRIAL
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">
            联系 / 预约
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
            填写下方表单，专属顾问将在 1 个工作日内联系你，安排 1 节免费体验课 + 1 次专业体测。
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[1.4fr_1fr]">
        {/* 表单 / 成功态 */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          {submitted ? (
            <div className="flex h-full flex-col items-start">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-accent text-2xl text-zinc-950">
                ✓
              </div>
              <h2 className="mt-5 text-2xl font-bold text-white">
                {submitted.name}，预约成功！
              </h2>
              <p className="mt-3 text-sm leading-7 text-zinc-400">
                我们已收到你的预约信息，专属顾问会尽快通过电话与你确认课程时间。
                下面是你的预约摘要：
              </p>
              <dl className="mt-6 w-full space-y-2 text-sm">
                <div className="flex justify-between gap-4 border-b border-white/5 pb-2">
                  <dt className="text-zinc-500">姓名</dt>
                  <dd className="font-medium text-white">{submitted.name}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-white/5 pb-2">
                  <dt className="text-zinc-500">手机</dt>
                  <dd className="font-medium text-white">{submitted.phone}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-white/5 pb-2">
                  <dt className="text-zinc-500">意向课程</dt>
                  <dd className="font-medium text-white">{submitted.course}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-white/5 pb-2">
                  <dt className="text-zinc-500">期望时间</dt>
                  <dd className="font-medium text-white">{submitted.time}</dd>
                </div>
                {submitted.note && (
                  <div className="flex justify-between gap-4 border-b border-white/5 pb-2">
                    <dt className="text-zinc-500">备注</dt>
                    <dd className="max-w-[60%] text-right font-medium text-white">
                      {submitted.note}
                    </dd>
                  </div>
                )}
              </dl>
              <button
                type="button"
                onClick={reset}
                className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/5"
              >
                再预约一次
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-white sm:text-2xl">预约体验课</h2>
              <p className="mt-2 text-sm text-zinc-400">
                标 <span className="text-accent">*</span> 为必填项。
              </p>
              <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="姓名"
                    required
                    error={errors.name}
                  >
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      placeholder="你的称呼"
                      className={inputClass(!!errors.name)}
                    />
                  </Field>
                  <Field label="手机" required error={errors.phone}>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={form.phone}
                      onChange={(e) => update("phone", e.target.value)}
                      placeholder="11 位手机号"
                      maxLength={11}
                      className={inputClass(!!errors.phone)}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="意向课程" required error={errors.course}>
                    <select
                      value={form.course}
                      onChange={(e) => update("course", e.target.value)}
                      className={inputClass(!!errors.course)}
                    >
                      <option value="">请选择课程</option>
                      {courses.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}（{c.category}）
                        </option>
                      ))}
                      <option value="暂未决定">暂未决定，需要顾问推荐</option>
                    </select>
                  </Field>
                  <Field label="期望时间" required error={errors.time}>
                    <select
                      value={form.time}
                      onChange={(e) => update("time", e.target.value)}
                      className={inputClass(!!errors.time)}
                    >
                      <option value="">请选择时段</option>
                      {timeOptions.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="备注（选填）">
                  <textarea
                    value={form.note}
                    onChange={(e) => update("note", e.target.value)}
                    placeholder="例如：之前有过膝伤，希望安排低冲击课程"
                    rows={3}
                    className={inputClass(false) + " resize-none"}
                  />
                </Field>

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-bold text-zinc-950 transition hover:bg-[var(--accent-strong)] sm:w-auto"
                >
                  提交预约 <span aria-hidden>→</span>
                </button>
              </form>
            </>
          )}
        </div>

        {/* 场馆信息 */}
        <aside className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="text-base font-bold text-white">场馆信息</h3>
            <ul className="mt-4 space-y-3 text-sm text-zinc-300">
              <li className="flex gap-3">
                <span aria-hidden>📍</span>
                <span>{studioInfo.address}</span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden>🚇</span>
                <span>{studioInfo.metro}</span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden>⏰</span>
                <span>{studioInfo.hours}</span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden>📞</span>
                <a href={`tel:${studioInfo.phone}`} className="hover:text-accent">
                  {studioInfo.phone}
                </a>
              </li>
              <li className="flex gap-3">
                <span aria-hidden>✉️</span>
                <a href={`mailto:${studioInfo.email}`} className="hover:text-accent">
                  {studioInfo.email}
                </a>
              </li>
            </ul>
          </div>

          <div className="rounded-3xl border border-accent/30 bg-gradient-to-br from-accent/15 to-zinc-950 p-6">
            <h3 className="text-base font-bold text-white">企业 / 团体训练</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              我们为团队客户提供定制化的团体训练方案与企业健康管理包，
              欢迎顾问沟通合作。
            </p>
            <a
              href={`mailto:${studioInfo.email}?subject=企业训练合作咨询`}
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"
            >
              发送合作邮件 <span aria-hidden>→</span>
            </a>
          </div>
        </aside>
      </section>
    </>
  );
}

function inputClass(error: boolean) {
  return (
    "mt-1 w-full rounded-lg border bg-zinc-950 px-3 py-2.5 text-white outline-none transition placeholder:text-zinc-600 focus:border-accent " +
    (error ? "border-rose-500/60" : "border-white/10")
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-400">
        {label} {required && <span className="text-accent">*</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-rose-400">{error}</span>}
    </label>
  );
}
