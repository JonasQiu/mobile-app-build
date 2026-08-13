"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { nav, navHref, studioInfo } from "@/lib/data";

export default function TopNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2"
          onClick={() => setOpen(false)}
        >
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-lg font-black text-zinc-950"
          >
            源
          </span>
          <span className="text-base font-bold tracking-tight text-white sm:text-lg">
            {studioInfo.brand}
          </span>
        </Link>

        {/* 桌面端导航 */}
        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((item) => {
            const active = isActive(navHref(item));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "rounded-full px-3 py-2 text-sm font-medium transition-colors " +
                  (active
                    ? "bg-accent text-zinc-950"
                    : "text-zinc-300 hover:bg-white/5 hover:text-white")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden md:block">
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
          >
            立即预约
            <span aria-hidden>→</span>
          </Link>
        </div>

        {/* 移动端汉堡按钮 */}
        <button
          type="button"
          aria-label={open ? "关闭菜单" : "打开菜单"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-white md:hidden"
        >
          <span aria-hidden className="text-xl leading-none">
            {open ? "✕" : "☰"}
          </span>
        </button>
      </div>

      {/* 移动端展开菜单 */}
      {open && (
        <nav className="border-t border-white/10 bg-zinc-950 md:hidden">
          <ul className="mx-auto flex max-w-6xl flex-col px-4 py-2 sm:px-6">
            {nav.map((item) => {
              const active = isActive(navHref(item));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={
                      "block rounded-lg px-3 py-3 text-base font-medium transition-colors " +
                      (active
                        ? "bg-accent text-zinc-950"
                        : "text-zinc-200 hover:bg-white/5")
                    }
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li className="py-2">
              <Link
                href="/contact"
                onClick={() => setOpen(false)}
                className="block rounded-lg bg-white px-3 py-3 text-center text-base font-semibold text-zinc-950"
              >
                立即预约
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
