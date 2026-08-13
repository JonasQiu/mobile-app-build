import Link from "next/link";
import Section from "./components/Section";
import BmiCalculator from "./components/BmiCalculator";
import {
  courses,
  stats,
  studioInfo,
  testimonials,
  trainers,
} from "@/lib/data";

const features = [
  {
    icon: "💪",
    title: "四大训练专区",
    desc: "力量、有氧、柔韧、搏击独立分区，器械齐全互不打扰，专业氛围拉满。",
  },
  {
    icon: "🎓",
    title: "38 位认证教练",
    desc: "NSCA-CSCS、Polestar、WBC 等国际认证，平均 8 年以上教学经验。",
  },
  {
    icon: "⏱️",
    title: "24H 全场馆",
    desc: "至尊年卡会员享受 24 小时不限时段，加班出差也能随时训练。",
  },
  {
    icon: "🥗",
    title: "1 对 1 营养咨询",
    desc: "注册营养师定制饮食方案，让训练成果真正在镜子里看得见。",
  },
];

export default function Home() {
  const featured = courses.slice(0, 6);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute -left-32 -top-24 h-96 w-96 rounded-full bg-accent/20 blur-[120px]" />
          <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-emerald-500/10 blur-[120px]" />
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                新会员首单 ¥99 体验
              </span>
              <h1 className="mt-5 text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl md:text-6xl">
                唤醒每一天的<br />
                <span className="text-accent">原动力</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400 sm:text-lg">
                {studioInfo.brand} 是一家以力量、有氧、柔韧、搏击为核心的高端健身俱乐部。
                38 位认证教练、120+ 月课程、24H 全场馆，让训练成为你最值得的日常投资。
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-bold text-zinc-950 transition hover:bg-[var(--accent-strong)]"
                >
                  免费预约体验课
                  <span aria-hidden>→</span>
                </Link>
                <Link
                  href="/courses"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/5"
                >
                  探索训练课程
                </Link>
              </div>
              <p className="mt-4 text-xs text-zinc-500">
                已有 <span className="font-semibold text-zinc-300">12,000+</span> 位会员与我们一同训练。
              </p>
            </div>

            <div className="relative">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-4">
                  <div className="aspect-[3/4] rounded-3xl bg-gradient-to-br from-lime-400/30 to-emerald-600/20 p-5 ring-1 ring-white/10">
                    <p className="text-xs uppercase tracking-widest text-accent">力量</p>
                    <p className="mt-12 text-2xl font-black text-white">硬拉</p>
                    <p className="text-sm text-zinc-400">突破 180kg</p>
                  </div>
                  <div className="aspect-square rounded-3xl bg-gradient-to-br from-amber-400/30 to-rose-500/20 p-5 ring-1 ring-white/10">
                    <p className="text-xs uppercase tracking-widest text-amber-300">搏击</p>
                    <p className="mt-6 text-2xl font-black text-white">泰拳</p>
                  </div>
                </div>
                <div className="space-y-4 pt-8">
                  <div className="aspect-square rounded-3xl bg-gradient-to-br from-sky-400/30 to-indigo-500/20 p-5 ring-1 ring-white/10">
                    <p className="text-xs uppercase tracking-widest text-sky-300">有氧</p>
                    <p className="mt-6 text-2xl font-black text-white">HIIT</p>
                  </div>
                  <div className="aspect-[3/4] rounded-3xl bg-gradient-to-br from-fuchsia-400/30 to-purple-600/20 p-5 ring-1 ring-white/10">
                    <p className="text-xs uppercase tracking-widest text-fuchsia-300">柔韧</p>
                    <p className="mt-12 text-2xl font-black text-white">普拉提</p>
                    <p className="text-sm text-zinc-400">核心重塑</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 数据带 */}
      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 sm:px-6 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.id} className="px-2 py-8 text-center sm:py-10">
              <p className="text-3xl font-black text-accent sm:text-4xl">{s.value}</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wider text-zinc-400 sm:text-sm">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 精选课程 */}
      <Section
        eyebrow="FEATURED COURSES"
        title="本月精选课程"
        description="从入门到进阶，找到最适合你的那一节。"
        className="mt-20"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((c) => (
            <Link
              key={c.id}
              href="/courses"
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-accent/40 hover:bg-white/[0.05]"
            >
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent">
                  {c.category}
                </span>
                <span className="text-xs text-zinc-500">{c.duration} 分钟</span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-white group-hover:text-accent">
                {c.name}
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{c.summary}</p>
              <div className="mt-5 flex items-center justify-between text-xs">
                <span className="text-zinc-500">
                  强度 <span className="text-zinc-300">{c.intensity}</span>
                </span>
                <span className="text-zinc-500">
                  约 <span className="font-semibold text-accent">{c.calories}</span> 大卡
                </span>
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link
            href="/courses"
            className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"
          >
            查看全部课程 <span aria-hidden>→</span>
          </Link>
        </div>
      </Section>

      {/* 为什么选择我们 */}
      <Section
        eyebrow="WHY US"
        title="为什么选择源动"
        description="我们不只是健身房，而是一整套可持续的健康生活方式。"
        className="mt-20"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:-translate-y-1 hover:border-accent/40"
            >
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-accent/15 text-2xl">
                {f.icon}
              </div>
              <h3 className="mt-4 text-base font-bold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* BMI 计算器 + 教练预告 */}
      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <BmiCalculator />
          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-accent/15 via-zinc-900 to-zinc-950 p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
              MEET THE TEAM
            </p>
            <h3 className="mt-3 text-2xl font-bold text-white sm:text-3xl">
              认识你的教练
            </h3>
            <p className="mt-3 text-sm leading-7 text-zinc-300">
              我们的教练团队涵盖力量、有氧、柔韧、搏击、营养等全领域，
              平均从业 8 年以上，全部持有国际权威认证。
            </p>
            <div className="mt-6 flex -space-x-3">
              {trainers.slice(0, 5).map((t) => (
                <div
                  key={t.id}
                  className="grid h-12 w-12 place-items-center rounded-full text-base font-bold text-zinc-950 ring-4 ring-zinc-950"
                  style={{ backgroundColor: `hsl(${t.hue} 90% 65%)` }}
                  aria-label={t.name}
                >
                  {t.name.charAt(0)}
                </div>
              ))}
              <div className="grid h-12 w-12 place-items-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-200 ring-4 ring-zinc-950">
                +33
              </div>
            </div>
            <Link
              href="/trainers"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
            >
              查看教练团队 <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 学员口碑 */}
      <Section
        eyebrow="STORIES"
        title="会员怎么说"
        description="真实的改变，来自真实的训练。"
        className="mt-20"
      >
        <div className="grid gap-4 md:grid-cols-3">
          {testimonials.map((t) => (
            <figure
              key={t.id}
              className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6"
            >
              <div className="mb-4 text-3xl leading-none text-accent">"</div>
              <blockquote className="flex-1 text-sm leading-7 text-zinc-200">
                {t.quote}
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <div
                  className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold text-zinc-950"
                  style={{ backgroundColor: `hsl(${t.hue} 90% 65%)` }}
                  aria-hidden
                >
                  {t.name.charAt(0)}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{t.name}</div>
                  <div className="text-xs text-zinc-500">{t.role}</div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      {/* 最终 CTA */}
      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-accent/30 bg-gradient-to-br from-accent/20 via-zinc-900 to-zinc-950 px-6 py-12 sm:px-12 sm:py-16">
          <div className="absolute -right-10 -top-10 h-60 w-60 rounded-full bg-accent/30 blur-[100px]" />
          <div className="relative">
            <h2 className="max-w-2xl text-3xl font-black leading-tight text-white sm:text-4xl">
              准备好开始你的<span className="text-accent">第一节课</span>了吗？
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-300 sm:text-base">
              留下你的联系方式，专属顾问会在 1 个工作日内联系你，
              为你安排 1 节免费体验课 + 1 次专业体测。
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/contact"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-bold text-zinc-950 transition hover:bg-[var(--accent-strong)]"
              >
                立即预约 <span aria-hidden>→</span>
              </Link>
              <Link
                href="/membership"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/5"
              >
                查看会员价格
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
