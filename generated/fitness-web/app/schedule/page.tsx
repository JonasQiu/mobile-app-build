"use client";

import { useMemo, useState } from "react";
import { schedule, weekDays, WeekDay } from "@/lib/data";

type Filter = "全部" | WeekDay;

export default function SchedulePage() {
  const [day, setDay] = useState<Filter>("全部");

  const visible = useMemo(
    () => (day === "全部" ? schedule : schedule.filter((s) => s.day === day)),
    [day],
  );

  // 按时间排序
  const sorted = useMemo(
    () => [...visible].sort((a, b) => a.time.localeCompare(b.time)),
    [visible],
  );

  return (
    <>
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-sky-500/10 via-zinc-950 to-zinc-950" />
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            WEEKLY SCHEDULE
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">
            周课表
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
            每周 30+ 节团课，按日筛选查看。所有课程均可在线预约，建议提前 2 小时锁定名额。
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {/* 日期 tabs */}
        <div className="flex flex-wrap gap-2">
          {weekDays.map((d) => {
            const active = day === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                className={
                  "rounded-full px-4 py-2 text-sm font-semibold transition " +
                  (active
                    ? "bg-accent text-zinc-950"
                    : "border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/5 hover:text-white")
                }
                aria-pressed={active}
              >
                {d}
              </button>
            );
          })}
        </div>

        {/* 课表 */}
        {sorted.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-white/10 p-12 text-center text-zinc-500">
            当日暂无排课。
          </div>
        ) : (
          <div className="mt-8 overflow-hidden rounded-2xl border border-white/10">
            {/* 表头（桌面端） */}
            <div className="hidden grid-cols-12 gap-2 border-b border-white/10 bg-white/[0.03] px-5 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-400 md:grid">
              <div className="col-span-2">时间</div>
              <div className="col-span-2">星期</div>
              <div className="col-span-4">课程</div>
              <div className="col-span-2">教练</div>
              <div className="col-span-2">教室</div>
            </div>
            <ul className="divide-y divide-white/5">
              {sorted.map((s) => (
                <li
                  key={s.id}
                  className="grid grid-cols-1 gap-1 px-5 py-4 transition hover:bg-white/[0.02] md:grid-cols-12 md:items-center md:gap-2"
                >
                  <div className="col-span-2 text-sm font-bold text-accent md:text-base">
                    {s.time}
                  </div>
                  <div className="col-span-2 md:text-sm">
                    <span className="inline-block rounded-full bg-white/5 px-2 py-0.5 text-xs text-zinc-300">
                      {s.day}
                    </span>
                  </div>
                  <div className="col-span-4 text-sm font-semibold text-white">
                    {s.courseName}
                  </div>
                  <div className="col-span-2 text-sm text-zinc-300">
                    <span className="text-zinc-500 md:hidden">教练：</span>
                    {s.trainerName}
                  </div>
                  <div className="col-span-2 text-sm text-zinc-400">
                    <span className="text-zinc-500 md:hidden">教室：</span>
                    {s.room}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}
