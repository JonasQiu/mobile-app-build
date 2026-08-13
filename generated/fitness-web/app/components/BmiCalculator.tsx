"use client";

import { useMemo, useState } from "react";

function classify(bmi: number): { label: string; color: string } {
  if (bmi <= 0) return { label: "请输入身高与体重", color: "text-zinc-400" };
  if (bmi < 18.5) return { label: "偏瘦 · 建议增肌", color: "text-sky-400" };
  if (bmi < 24) return { label: "正常 · 继续保持", color: "text-accent" };
  if (bmi < 28) return { label: "超重 · 建议减脂", color: "text-amber-400" };
  return { label: "肥胖 · 建议系统训练", color: "text-rose-400" };
}

export default function BmiCalculator() {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");

  const bmi = useMemo(() => {
    const h = parseFloat(height);
    const w = parseFloat(weight);
    if (!h || !w || h <= 0 || w <= 0) return 0;
    const m = h / 100;
    return w / (m * m);
  }, [height, weight]);

  const cls = classify(bmi);
  const display = bmi > 0 ? bmi.toFixed(1) : "--";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
      <h3 className="text-xl font-bold text-white">BMI 身体质量指数</h3>
      <p className="mt-2 text-sm text-zinc-400">
        输入身高与体重，了解你的身体底子，教练会根据结果定制训练强度。
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs font-medium text-zinc-400">身高 (cm)</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="例如 175"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2.5 text-white outline-none transition focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-400">体重 (kg)</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="例如 68"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2.5 text-white outline-none transition focus:border-accent"
          />
        </label>
      </div>

      <div className="mt-6 flex items-end justify-between rounded-xl bg-zinc-950/60 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-500">你的 BMI</p>
          <p className="mt-1 text-4xl font-black text-white tabular-nums">
            {display}
          </p>
        </div>
        <p className={"text-sm font-semibold " + cls.color}>{cls.label}</p>
      </div>
    </div>
  );
}
