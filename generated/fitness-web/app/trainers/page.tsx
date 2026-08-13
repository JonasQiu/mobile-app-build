import Link from "next/link";
import { trainers } from "@/lib/data";

export default function TrainersPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-emerald-500/10 via-zinc-950 to-zinc-950" />
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            OUR COACHES
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">
            教练团队
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
            38 位认证教练，覆盖力量、有氧、柔韧、搏击、营养全领域。
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {trainers.map((t) => (
            <article
              key={t.id}
              className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-accent/40 hover:bg-white/[0.05]"
            >
              <div className="relative flex h-40 items-center justify-center overflow-hidden">
                <div
                  className="absolute inset-0 opacity-90"
                  style={{
                    background: `radial-gradient(120% 80% at 50% 0%, hsl(${t.hue} 90% 55% / 0.55), transparent 70%)`,
                  }}
                />
                <div
                  className="relative grid h-20 w-20 place-items-center rounded-full text-3xl font-black text-zinc-950 shadow-lg ring-4 ring-white/10"
                  style={{ backgroundColor: `hsl(${t.hue} 90% 65%)` }}
                  aria-hidden
                >
                  {t.name.charAt(0)}
                </div>
              </div>
              <div className="p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-lg font-bold text-white">{t.name}</h3>
                  <span className="text-xs text-zinc-500">{t.experienceYears} 年经验</span>
                </div>
                <p className="mt-1 text-xs font-medium text-accent">{t.title}</p>
                <p className="mt-3 text-sm leading-6 text-zinc-400">{t.bio}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {t.specialties.map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs text-zinc-300"
                    >
                      {s}
                    </span>
                  ))}
                </div>
                <div className="mt-5">
                  <Link
                    href="/contact"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
                  >
                    向 {t.name.charAt(0)} 教练预约 <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
