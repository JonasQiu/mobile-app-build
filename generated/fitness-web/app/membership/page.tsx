"use client";

import Link from "next/link";
import { useState } from "react";
import { faqs, membershipTiers } from "@/lib/data";

type Billing = "monthly" | "yearly";

export default function MembershipPage() {
  const [billing, setBilling] = useState<Billing>("monthly");
  const [openFaq, setOpenFaq] = useState<string | null>(faqs[0]?.id ?? null);

  return (
    <>
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-fuchsia-500/10 via-zinc-950 to-zinc-950" />
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            MEMBERSHIP
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">
            会员价格
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
            透明的价格、灵活的方案。年付立省两个月会费，无隐形消费、无长期绑定。
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {/* 月付 / 年付 切换 */}
        <div className="flex items-center justify-center">
          <div
            role="tablist"
            aria-label="计费方式"
            className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={billing === "monthly"}
              onClick={() => setBilling("monthly")}
              className={
                "rounded-full px-5 py-2 text-sm font-semibold transition " +
                (billing === "monthly"
                  ? "bg-accent text-zinc-950"
                  : "text-zinc-300 hover:text-white")
              }
            >
              月付
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={billing === "yearly"}
              onClick={() => setBilling("yearly")}
              className={
                "rounded-full px-5 py-2 text-sm font-semibold transition " +
                (billing === "yearly"
                  ? "bg-accent text-zinc-950"
                  : "text-zinc-300 hover:text-white")
              }
            >
              年付
              <span className="ml-2 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                省 2 个月
              </span>
            </button>
          </div>
        </div>

        {/* 套餐 */}
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {membershipTiers.map((t) => {
            const price = billing === "monthly" ? t.monthly : t.yearly;
            const unit = billing === "monthly" ? "/ 月" : "/ 年";
            return (
              <div
                key={t.id}
                className={
                  "relative flex h-full flex-col rounded-3xl border p-6 transition sm:p-8 " +
                  (t.highlight
                    ? "border-accent bg-gradient-to-b from-accent/15 to-zinc-950 shadow-[0_0_60px_-15px_rgba(169,255,87,0.4)]"
                    : "border-white/10 bg-white/[0.03]")
                }
              >
                {t.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-bold text-zinc-950">
                    最受欢迎
                  </span>
                )}
                <h3 className="text-lg font-bold text-white">{t.name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-accent">¥</span>
                  <span className="text-5xl font-black tabular-nums text-white">
                    {price.toLocaleString("zh-CN")}
                  </span>
                  <span className="ml-1 text-sm text-zinc-500">{unit}</span>
                </div>
                <ul className="mt-6 space-y-3 text-sm">
                  {t.perks.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-zinc-300">
                      <span className="mt-0.5 text-accent" aria-hidden>
                        ✓
                      </span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-8 pt-2">
                  <Link
                    href="/contact"
                    className={
                      "inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition " +
                      (t.highlight
                        ? "bg-accent text-zinc-950 hover:bg-[var(--accent-strong)]"
                        : "border border-white/15 text-white hover:bg-white/5")
                    }
                  >
                    选择 {t.name} <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {/* FAQ */}
        <div className="mt-20">
          <h2 className="title-bar text-2xl font-bold tracking-tight text-white sm:text-3xl">
            常见问题
          </h2>
          <div className="mt-6 divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10">
            {faqs.map((f) => {
              const open = openFaq === f.id;
              return (
                <div key={f.id} className="bg-white/[0.02]">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : f.id)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/[0.03]"
                  >
                    <span className="text-sm font-semibold text-white sm:text-base">
                      {f.question}
                    </span>
                    <span
                      className={
                        "shrink-0 text-xl text-accent transition-transform " +
                        (open ? "rotate-45" : "")
                      }
                      aria-hidden
                    >
                      +
                    </span>
                  </button>
                  {open && (
                    <div className="px-5 pb-5 text-sm leading-7 text-zinc-400">
                      {f.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
