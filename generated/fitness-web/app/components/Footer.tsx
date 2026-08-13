import Link from "next/link";
import { nav, navHref, studioInfo } from "@/lib/data";

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-white/10 bg-zinc-950">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-lg font-black text-zinc-950"
            >
              源
            </span>
            <span className="text-base font-bold text-white">
              {studioInfo.brand}
            </span>
          </div>
          <p className="mt-4 max-w-md text-sm leading-6 text-zinc-400">
            {studioInfo.slogan}。我们相信每个人都可以拥有一份属于自己的、可持续的健身生活方式。
          </p>
          <p className="mt-4 text-sm text-zinc-500">营业时间：{studioInfo.hours}</p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white">快速导航</h4>
          <ul className="mt-4 space-y-2">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sm text-zinc-400 transition-colors hover:text-accent"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white">联系我们</h4>
          <ul className="mt-4 space-y-2 text-sm text-zinc-400">
            <li>📞 <a href={`tel:${studioInfo.phone}`} className="hover:text-accent">{studioInfo.phone}</a></li>
            <li>✉️ <a href={`mailto:${studioInfo.email}`} className="hover:text-accent">{studioInfo.email}</a></li>
            <li>📍 {studioInfo.address}</li>
            <li>🚇 {studioInfo.metro}</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-zinc-500 sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} {studioInfo.brand}. 保留所有权利。</p>
          <p>沪 ICP 备 2024-XXXXXX 号</p>
        </div>
      </div>
    </footer>
  );
}
