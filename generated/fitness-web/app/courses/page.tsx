"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { courseCategories, courses, CourseCategory } from "@/lib/data";

type Filter = "全部" | CourseCategory;

const intensityColor: Record<string, string> = {
  低: "bg-sky-500/15 text-sky-300",
  中: "bg-amber-500/15 text-amber-300",
  高: "bg-rose-500/15 text-rose-300",
};

const categoryColor: Record<string, string> = {
  力量: "from-lime-400/30 to-emerald-600/10",
  有氧: "from-sky-400/30 to-indigo-500/10",
  柔韧: "from-fuchsia-400/30 to-purple-600/10",
  搏击: "from-amber-400/30 to-rose-500/10",
};

export default function CoursesPage() {
  const [filter, setFilter] = useState<Filter>("全部");

  const visible = useMemo(
    () => (filter === "全部" ? courses : courses.filter((c) => c.category === filter)),
    [filter],
  );

  return (
    <>
      {/* 头图 */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-accent/10 via-zinc-950 to-zinc-950" />
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            TRAINING COURSES
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">
            训练课程
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
            120+ 门月度课程，覆盖力量、有氧、柔韧、搏击四大方向。
            每节课都由专业认证教练带领，无论零基础还是进阶者都能找到适合自己的节奏。
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {/* 筛选 tabs */}
        <div className="flex flex-wrap gap-2">
          {courseCategories.map((cat) => {
            const active = filter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                className={
                  "rounded-full px-4 py-2 text-sm font-semibold transition " +
                  (active
                    ? "bg-accent text-zinc-950"
                    : "border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/5 hover:text-white")
                }
                aria-pressed={active}
              >
                {cat}
              </button>
            );
          })}
          <span className="ml-auto self-center text-xs text-zinc-500">
            共 <span className="font-semibold text-zinc-300">{visible.length}</span> 门课程
          </span>
        </div>

        {/* 课程网格 */}
        {visible.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-white/10 p-12 text-center text-zinc-500">
            该分类暂无课程。
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((c) => (
              <article
                key={c.id}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-accent/40 hover:bg-white/[0.05]"
              >
                <div
                  className={
                    "relative h-28 bg-gradient-to-br p-5 " +
                    (categoryColor[c.category] ?? "from-zinc-700/40 to-zinc-900/10")
                  }
                >
                  <span className="rounded-full bg-black/30 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
                    {c.category}
                  </span>
                  <span className="absolute right-4 top-4 text-xs font-medium text-white/80">
                    ⏱ {c.duration} min
                  </span>
                  <h3 className="absolute bottom-4 left-5 text-xl font-black text-white drop-shadow">
                    {c.name}
                  </h3>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <p className="text-sm leading-6 text-zinc-400">{c.description}</p>
                  <div className="mt-4 flex items-center gap-2 text-xs">
                    <span
                      className={
                        "rounded-full px-2 py-0.5 font-semibold " +
                        (intensityColor[c.intensity] ?? "bg-white/10 text-zinc-200")
                      }
                    >
                      强度 {c.intensity}
                    </span>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-zinc-300">
                      约 {c.calories} 大卡
                    </span>
                  </div>
                  <div className="mt-auto pt-5">
                    <Link
                      href="/contact"
                      className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
                    >
                      预约这节课 <span aria-hidden>→</span>
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
