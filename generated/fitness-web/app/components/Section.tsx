import { ReactNode } from "react";

interface SectionProps {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export default function Section({
  eyebrow,
  title,
  description,
  children,
  className = "",
}: SectionProps) {
  return (
    <section className={"mx-auto max-w-6xl px-4 sm:px-6 " + className}>
      <div className="max-w-2xl">
        {eyebrow && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            {eyebrow}
          </p>
        )}
        <h2 className="title-bar text-2xl font-bold tracking-tight text-white sm:text-3xl md:text-4xl">
          {title}
        </h2>
        {description && (
          <p className="mt-4 text-sm leading-7 text-zinc-400 sm:text-base">
            {description}
          </p>
        )}
      </div>
      <div className="mt-8 sm:mt-10">{children}</div>
    </section>
  );
}
