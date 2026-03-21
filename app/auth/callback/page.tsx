"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { getSupabaseBrowserClient } from "@/lib/client/supabase-browser";

type CallbackState = "loading" | "success" | "error";

const ALLOWED_OTP_TYPES = new Set([
  "magiclink",
  "email",
  "recovery",
  "invite",
  "email_change"
]);

export default function AuthCallbackPage() {
  const [state, setState] = useState<CallbackState>("loading");
  const [message, setMessage] = useState("正在校验登录链接...");

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        if (cancelled) return;
        setState("error");
        setMessage("当前未配置 Supabase，无法完成登录。");
        return;
      }

      try {
        const params = readSearchParams();
        const tokenHash = (params.get("token_hash") || "").trim();
        const typeRaw = (params.get("type") || "").trim();
        const type = ALLOWED_OTP_TYPES.has(typeRaw) ? typeRaw : "";

        if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as "magiclink" | "email" | "recovery" | "invite" | "email_change"
          });
          if (error) throw error;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session?.user) {
          throw new Error("链接已过期或验证失败，请返回设置页重新发送登录邮件。");
        }

        if (cancelled) return;
        setState("success");
        setMessage("邮箱登录成功，正在返回设置页...");
        window.setTimeout(() => {
          window.location.replace("/settings");
        }, 900);
      } catch (error) {
        if (cancelled) return;
        setState("error");
        setMessage(formatError(error));
      }
    };

    void verify();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <SiteHeader active="settings" />
      <main className="settings-page">
        <div className="container">
          <section className="settings-panel" style={{ maxWidth: 560, margin: "48px auto" }}>
            <header className="settings-panel-title">
              <span className="settings-panel-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <path d="M4.8 10.2 8.6 14l6.6-7.4" />
                </svg>
              </span>
              <h2>邮箱登录验证</h2>
            </header>
            <p className="settings-auth-sub" style={{ marginTop: 10 }}>
              {message}
            </p>
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <Link className="settings-action-btn" href="/settings">
                返回设置页
              </Link>
              {state === "error" ? (
                <Link className="settings-action-btn" href="/settings">
                  重新发送登录邮件
                </Link>
              ) : null}
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function readSearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) return `验证失败：${error.message}`;
  return "验证失败：链接已失效，请返回设置页重试。";
}
