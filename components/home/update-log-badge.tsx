"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangelogEntry } from "@/content/changelog";

type UpdateLogBadgeProps = {
  entries: ChangelogEntry[];
};

export function UpdateLogBadge({ entries }: UpdateLogBadgeProps) {
  const [open, setOpen] = useState(false);
  const latest = useMemo(() => entries[0], [entries]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!latest) return null;

  return (
    <>
      <button
        type="button"
        className="update-badge update-badge-btn"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="dot" />
        最新更新：{latest.title}
      </button>

      {open ? (
        <div className="update-log-overlay" role="presentation" onClick={() => setOpen(false)}>
          <section
            className="update-log-modal"
            role="dialog"
            aria-modal="true"
            aria-label="更新日志"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="update-log-header">
              <div className="update-log-header-copy">
                <h2>
                  <span className="update-log-title-icon" aria-hidden="true">
                    <svg viewBox="0 0 20 20">
                      <path d="M10 3a4.6 4.6 0 0 0-4.6 4.6v2.8L4 12.2V13h12v-.8l-1.4-1.8V7.6A4.6 4.6 0 0 0 10 3z" />
                      <path d="M8.3 14.7a1.9 1.9 0 0 0 3.4 0" />
                    </svg>
                  </span>
                  更新日志
                </h2>
                <p>记录清一山长投资研究平台的关键迭代，便于持续追踪版本变化。</p>
              </div>

              <button type="button" className="update-log-close" aria-label="关闭更新日志" onClick={() => setOpen(false)}>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 5l10 10M15 5 5 15" />
                </svg>
              </button>
            </header>

            <div className="update-log-content">
              {entries.map((entry) => (
                <article key={`${entry.date}-${entry.title}`} className="update-log-entry">
                  <p className="update-log-date">{entry.date}</p>
                  <h3>{entry.title}</h3>
                  <p className="update-log-summary">{entry.summary}</p>

                  {entry.intro.map((line) => (
                    <p key={line} className="update-log-paragraph">
                      {line}
                    </p>
                  ))}

                  {entry.sections.map((section) => (
                    <section key={section.title} className="update-log-section">
                      <h4>{section.title}</h4>
                      {section.paragraphs?.map((line) => (
                        <p key={line} className="update-log-paragraph">
                          {line}
                        </p>
                      ))}
                      {section.bullets?.length ? (
                        <ul className="update-log-bullets">
                          {section.bullets.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                    </section>
                  ))}
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
