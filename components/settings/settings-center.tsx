"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent
} from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  ARTICLE_STATE_CHANGED_EVENT,
  readAllStoredStatuses,
  type ArticleUserStatus
} from "@/lib/client/article-user-state";
import {
  ARTICLE_ANNOTATIONS_CHANGED_EVENT,
  type ArticleAnnotation
} from "@/lib/client/article-annotations-store";
import {
  readUserProfile,
  USER_PROFILE_STORAGE_KEY,
  USER_PROFILE_UPDATED_EVENT,
  writeUserProfile,
  type UserProfile
} from "@/lib/client/user-profile-store";
import { getSupabaseBrowserClient, isSupabaseAuthEnabled } from "@/lib/client/supabase-browser";
import {
  clearSyncMetricEvents,
  readSyncMetricEvents,
  readSyncMetricSummary,
  type SyncMetricSummary
} from "@/lib/client/sync-observability";

type AuthMethod = "email" | "phone";

type LocalSyncStats = {
  unread: number;
  read: number;
  viewed: number;
  annotations: number;
  totalLocalEntries: number;
};

type SyncMeta = {
  lastImportAt: number | null;
  count: number;
};

type Banner = {
  tone: "success" | "warn";
  text: string;
} | null;

type OtpChallenge = {
  method: AuthMethod;
  identifier: string;
};

type TimeZoneOption = {
  value: string;
  label: string;
};

type BackupPreview = {
  fileName: string;
  payload: LocalBackupPayload;
  statusCount: number;
  annotationCount: number;
};

type LocalBackupPayload = {
  version: number;
  exportedAt: string;
  profile: UserProfile;
  syncMeta: SyncMeta;
  readingStates: Record<string, ArticleUserStatus>;
  annotationsBySlug: Record<string, ArticleAnnotation[]>;
};

const STATUS_PREFIX = "article-state:";
const ANNOTATION_PREFIX = "article-annotations:";
const SYNC_META_STORAGE_KEY = "user-settings-sync-meta-v1";
const LOCAL_IMPORT_PROMPT_PREFIX = "settings-local-import-prompted:";
const LOCAL_BACKUP_VERSION = 1;
const LOCAL_BACKUP_MAX_BYTES = 8 * 1024 * 1024;
const SYNC_DIAGNOSTIC_EVENT_LIMIT = 160;

const TIMEZONE_OPTIONS: TimeZoneOption[] = [
  { value: "Asia/Shanghai", label: "(UTC+08:00) Beijing" },
  { value: "Asia/Tokyo", label: "(UTC+09:00) Tokyo" },
  { value: "Europe/London", label: "(UTC+00:00) London" },
  { value: "America/New_York", label: "(UTC-05:00) New York" }
];

const LEGACY_TIMEZONE_MAP: Record<string, string> = {
  "(UTC+08:00) Beijing": "Asia/Shanghai",
  "(UTC+09:00) Tokyo": "Asia/Tokyo",
  "(UTC+00:00) London": "Europe/London",
  "(UTC-05:00) New York": "America/New_York"
};

const DEFAULT_PROFILE: UserProfile = {
  avatarDataUrl: "",
  username: "",
  phone: "",
  email: "",
  timezone: "Asia/Shanghai"
};

const DEFAULT_SYNC_META: SyncMeta = {
  lastImportAt: null,
  count: 0
};

const DEFAULT_LOCAL_SYNC_STATS: LocalSyncStats = {
  unread: 0,
  read: 0,
  viewed: 0,
  annotations: 0,
  totalLocalEntries: 0
};
const DEFAULT_SYNC_HEALTH: SyncMetricSummary = {
  total: 0,
  failed: 0,
  averageDurationMs: 0,
  lastFailureAt: null,
  lastFailureMessage: "",
  byChannel: {
    status: { total: 0, failed: 0 },
    annotation: { total: 0, failed: 0 }
  }
};

const AUTH_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_OTP_AUTH === "true";
const PHONE_OTP_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PHONE_OTP === "true";

export function SettingsCenter() {
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [syncStats, setSyncStats] = useState<LocalSyncStats>(DEFAULT_LOCAL_SYNC_STATS);
  const [syncMeta, setSyncMeta] = useState<SyncMeta>(DEFAULT_SYNC_META);
  const [syncHealth, setSyncHealth] = useState<SyncMetricSummary>(DEFAULT_SYNC_HEALTH);
  const [banner, setBanner] = useState<Banner>(null);

  const [supabaseEnabled, setSupabaseEnabled] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("email");
  const [authIdentifier, setAuthIdentifier] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpChallenge, setOtpChallenge] = useState<OtpChallenge | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);

  const loadLocalProfile = useCallback(() => {
    const savedProfile = readUserProfile();
    if (!savedProfile) {
      setProfile(DEFAULT_PROFILE);
      return;
    }

    const normalized: UserProfile = {
      avatarDataUrl: savedProfile.avatarDataUrl || "",
      username: savedProfile.username || "",
      phone: savedProfile.phone || "",
      email: savedProfile.email || "",
      timezone: normalizeTimezone(savedProfile.timezone)
    };

    setProfile(normalized);

    if (savedProfile.timezone !== normalized.timezone && typeof window !== "undefined") {
      writeUserProfile(normalized);
    }
  }, []);

  const refreshLocalStats = useCallback(() => {
    if (typeof window === "undefined") return;

    const statusMap = readAllStoredStatuses();
    const statusValues = Object.values(statusMap);

    let annotationCount = 0;
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(ANNOTATION_PREFIX)) continue;
      annotationCount += safeParseAnnotationArray(window.localStorage.getItem(key)).length;
    }

    const unread = statusValues.filter((item) => item === "unread").length;
    const read = statusValues.filter((item) => item === "read" || item === "favorite").length;
    const viewed = statusValues.length;

    setSyncStats({
      unread,
      read,
      viewed,
      annotations: annotationCount,
      totalLocalEntries: viewed + annotationCount
    });
  }, []);

  const refreshSyncHealth = useCallback(() => {
    setSyncHealth(readSyncMetricSummary(24));
  }, []);

  const hydrateAccountProfile = useCallback(async (user: User) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    // Ensure profile/sync rows exist for old accounts.
    await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email: user.email || "",
          phone: user.phone || ""
        },
        { onConflict: "id" }
      );

    await supabase
      .from("user_sync_meta")
      .upsert({ user_id: user.id }, { onConflict: "user_id" });

    const [{ data: profileRow, error: profileError }, { data: metaRow, error: metaError }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("username, avatar_url, phone, email, timezone")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("user_sync_meta")
          .select("last_import_at, last_import_count")
          .eq("user_id", user.id)
          .maybeSingle()
      ]);

    if (profileError) {
      setBanner({ tone: "warn", text: "账号资料读取失败，请稍后重试" });
      return;
    }
    if (metaError) {
      setBanner({ tone: "warn", text: "同步信息读取失败，请稍后重试" });
      return;
    }

    const nextProfile: UserProfile = {
      avatarDataUrl: normalizeText(profileRow?.avatar_url) || "",
      username: normalizeText(profileRow?.username) || "",
      phone: normalizeText(profileRow?.phone) || normalizeText(user.phone),
      email: normalizeText(profileRow?.email) || normalizeText(user.email),
      timezone: normalizeTimezone(normalizeText(profileRow?.timezone))
    };
    setProfile(nextProfile);
    writeUserProfile(nextProfile);

    const nextMeta: SyncMeta = {
      lastImportAt: profileDateToMillis(metaRow?.last_import_at),
      count: typeof metaRow?.last_import_count === "number" ? metaRow.last_import_count : 0
    };
    setSyncMeta(nextMeta);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(nextMeta));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    loadLocalProfile();

    const savedMeta = safeParseObject<SyncMeta>(window.localStorage.getItem(SYNC_META_STORAGE_KEY));
    if (savedMeta) {
      setSyncMeta({
        lastImportAt: typeof savedMeta.lastImportAt === "number" ? savedMeta.lastImportAt : null,
        count: typeof savedMeta.count === "number" ? savedMeta.count : 0
      });
    }

    refreshLocalStats();
    refreshSyncHealth();

    const onProfileUpdate = () => loadLocalProfile();
    const onStorage = (event: StorageEvent) => {
      if (event.key === USER_PROFILE_STORAGE_KEY) {
        loadLocalProfile();
        return;
      }
      if (event.key?.startsWith(STATUS_PREFIX) || event.key?.startsWith(ANNOTATION_PREFIX)) {
        refreshLocalStats();
        refreshSyncHealth();
      }
    };
    const onStateChanged = () => {
      refreshLocalStats();
      refreshSyncHealth();
    };
    const onAnnotationChanged = () => {
      refreshLocalStats();
      refreshSyncHealth();
    };

    window.addEventListener(USER_PROFILE_UPDATED_EVENT, onProfileUpdate as EventListener);
    window.addEventListener("storage", onStorage);
    window.addEventListener(ARTICLE_STATE_CHANGED_EVENT, onStateChanged as EventListener);
    window.addEventListener(ARTICLE_ANNOTATIONS_CHANGED_EVENT, onAnnotationChanged as EventListener);

    return () => {
      window.removeEventListener(USER_PROFILE_UPDATED_EVENT, onProfileUpdate as EventListener);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ARTICLE_STATE_CHANGED_EVENT, onStateChanged as EventListener);
      window.removeEventListener(ARTICLE_ANNOTATIONS_CHANGED_EVENT, onAnnotationChanged as EventListener);
    };
  }, [loadLocalProfile, refreshLocalStats, refreshSyncHealth]);

  useEffect(() => {
    if (!banner) return;
    const timeout = banner.tone === "warn" ? 7000 : 3000;
    const timer = window.setTimeout(() => setBanner(null), timeout);
    return () => window.clearTimeout(timer);
  }, [banner]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const enabled = isSupabaseAuthEnabled() && AUTH_LOGIN_ENABLED;
    setSupabaseEnabled(enabled);
    if (!enabled) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const user = data.session?.user ?? null;
      setAuthUser(user);
      if (user) {
        void hydrateAccountProfile(user);
      }
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setAuthUser(user);
      setOtpChallenge(null);
      setOtpCode("");

      if (user) {
        void hydrateAccountProfile(user);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [hydrateAccountProfile]);

  const usernameDisplay = useMemo(
    () => (profile.username.trim() ? profile.username.trim() : "未设置"),
    [profile.username]
  );
  const phoneDisplay = useMemo(
    () =>
      profile.phone.trim()
        ? profile.phone.trim()
        : normalizeText(authUser?.phone) || "未绑定",
    [authUser?.phone, profile.phone]
  );
  const emailDisplay = useMemo(
    () =>
      profile.email.trim()
        ? profile.email.trim()
        : normalizeText(authUser?.email) || "未绑定",
    [authUser?.email, profile.email]
  );
  const timezoneLabel = useMemo(
    () => getTimezoneLabel(profile.timezone),
    [profile.timezone]
  );
  const authStatusText = useMemo(() => {
    if (!AUTH_LOGIN_ENABLED) return "登录能力暂缓开发（当前本地模式）";
    if (!supabaseEnabled) return "未配置 Supabase 环境变量（当前仅本地模式）";
    if (!authUser) return "未登录";
    return authUser.email || authUser.phone || `UID ${authUser.id.slice(0, 8)}`;
  }, [authUser, supabaseEnabled]);

  const persistProfile = useCallback(
    async (next: UserProfile): Promise<boolean> => {
      setProfile(next);
      writeUserProfile(next);

      if (!supabaseEnabled || !authUser) return true;

      const supabase = getSupabaseBrowserClient();
      if (!supabase) return true;

      const { error } = await supabase.from("profiles").upsert(
        {
          id: authUser.id,
          username: next.username,
          avatar_url: next.avatarDataUrl,
          phone: next.phone,
          email: next.email,
          timezone: normalizeTimezone(next.timezone)
        },
        { onConflict: "id" }
      );

      if (error) {
        setBanner({ tone: "warn", text: "资料保存失败，请重试" });
        return false;
      }

      return true;
    },
    [authUser, supabaseEnabled]
  );

  const editTextField = async (
    key: "username" | "phone" | "email",
    title: string,
    emptyHint: string
  ) => {
    const current = profile[key];
    const input = window.prompt(title, current);
    if (input === null) return;

    const value = input.trim();
    const next: UserProfile = {
      ...profile,
      [key]: value
    };

    const ok = await persistProfile(next);
    if (!ok) return;

    if ((key === "phone" || key === "email") && authUser) {
      setBanner({
        tone: "success",
        text: value
          ? "资料字段已更新（登录绑定请使用验证码）"
          : "资料字段已清空"
      });
      return;
    }
    setBanner({ tone: "success", text: value ? "已更新" : emptyHint });
  };

  const onAvatarFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) return;

      const ok = await persistProfile({ ...profile, avatarDataUrl: dataUrl });
      if (ok) {
        setBanner({ tone: "success", text: "头像已更新（右上角同步）" });
      }
    };
    reader.readAsDataURL(file);
  };

  const onTimezoneChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const next = normalizeTimezone(event.target.value);
    const ok = await persistProfile({ ...profile, timezone: next });
    if (ok) {
      setBanner({ tone: "success", text: "时区已更新（页面时间按该时区显示）" });
    }
  };

  const sendOtp = async () => {
    if (!AUTH_LOGIN_ENABLED) {
      setBanner({ tone: "warn", text: "登录功能暂缓开发，当前阶段先聚焦其他能力。" });
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !supabaseEnabled) {
      setBanner({ tone: "warn", text: "当前未配置 Supabase，无法登录" });
      return;
    }

    const rawIdentifier = normalizeText(authIdentifier);
    if (!rawIdentifier) {
      setBanner({ tone: "warn", text: authMethod === "email" ? "请输入邮箱" : "请输入手机号" });
      return;
    }

    const identifier =
      authMethod === "email"
        ? normalizeEmail(rawIdentifier)
        : normalizePhoneForOtp(rawIdentifier);

    if (authMethod === "email" && !isValidEmail(identifier)) {
      setBanner({ tone: "warn", text: "邮箱格式不正确" });
      return;
    }
    if (authMethod === "phone" && !PHONE_OTP_ENABLED) {
      setBanner({
        tone: "warn",
        text: "手机号验证码登录待开通（短信服务未配置），请先使用邮箱登录"
      });
      return;
    }
    if (authMethod === "phone" && !isValidPhone(identifier)) {
      setBanner({
        tone: "warn",
        text: "手机号格式不正确，请使用 +国家码 形式，或输入 11 位中国手机号"
      });
      return;
    }

    setAuthBusy(true);
    try {
      const response =
        authMethod === "email"
          ? await supabase.auth.signInWithOtp({
              email: identifier,
              options: {
                shouldCreateUser: true
              }
            })
          : await supabase.auth.signInWithOtp({
              phone: identifier,
              options: { shouldCreateUser: true }
            });

      if (response.error) {
        throw response.error;
      }

      setOtpChallenge({ method: authMethod, identifier });
      setBanner({
        tone: "success",
        text:
          authMethod === "email"
            ? "6位邮箱验证码已发送，请输入验证码并点击“验证并登录”"
            : "验证码已发送到手机，请输入后验证"
      });
    } catch (error) {
      const errorText = formatErrorMessage(error).toLowerCase();
      const isRateLimit =
        errorText.includes("rate limit") ||
        errorText.includes("over_email_send_rate_limit") ||
        errorText.includes("too many requests") ||
        errorText.includes("429");
      setBanner({
        tone: "warn",
        text: isRateLimit
          ? "发送过于频繁，邮箱通道被限流。请等待几分钟后重试。"
          : `发送验证码失败：${formatErrorMessage(error)}`
      });
    } finally {
      setAuthBusy(false);
    }
  };

  const verifyOtpAndLogin = async () => {
    if (!AUTH_LOGIN_ENABLED) {
      setBanner({ tone: "warn", text: "登录功能暂缓开发，当前阶段先聚焦其他能力。" });
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !supabaseEnabled) {
      setBanner({ tone: "warn", text: "当前未配置 Supabase，无法登录" });
      return;
    }
    if (!otpChallenge) {
      setBanner({ tone: "warn", text: "请先发送验证码" });
      return;
    }

    const token = normalizeText(otpCode).replace(/\s+/g, "");
    if (!token) {
      setBanner({ tone: "warn", text: "请输入验证码" });
      return;
    }
    if (otpChallenge.method === "email" && !/^\d{6}$/.test(token)) {
      setBanner({ tone: "warn", text: "请输入6位数字验证码" });
      return;
    }

    setAuthBusy(true);
    try {
      const response =
        otpChallenge.method === "email"
          ? await supabase.auth.verifyOtp({
              email: otpChallenge.identifier,
              token,
              type: "email"
            })
          : await supabase.auth.verifyOtp({
              phone: otpChallenge.identifier,
              token,
              type: "sms"
            });

      if (response.error) {
        throw response.error;
      }

      setBanner({ tone: "success", text: "登录成功" });
      setOtpCode("");
      setOtpChallenge(null);
    } catch (error) {
      const errorText = formatErrorMessage(error).toLowerCase();
      const isCodeMismatch =
        errorText.includes("invalid token") ||
        errorText.includes("token has expired") ||
        errorText.includes("otp") ||
        errorText.includes("expired");
      setBanner({
        tone: "warn",
        text: isCodeMismatch
          ? "验证码错误或已过期，请重新发送后再试"
          : `验证码校验失败：${formatErrorMessage(error)}`
      });
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setAuthBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setBanner({ tone: "success", text: "已退出登录" });
      setAuthUser(null);
    } catch (error) {
      setBanner({ tone: "warn", text: `退出失败：${formatErrorMessage(error)}` });
    } finally {
      setAuthBusy(false);
    }
  };

  const clearLocalReadingData = () => {
    if (typeof window === "undefined") return;

    const confirmed = window.confirm("确认清除本地阅读状态与标注数据吗？");
    if (!confirmed) return;

    const keysToDelete: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(STATUS_PREFIX) || key.startsWith(ANNOTATION_PREFIX)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => window.localStorage.removeItem(key));

    refreshLocalStats();
    setBanner({ tone: "warn", text: "本地阅读数据已清除" });
  };

  const exportLocalBackup = () => {
    if (typeof window === "undefined") return;

    const payload: LocalBackupPayload = {
      version: LOCAL_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      profile: {
        avatarDataUrl: profile.avatarDataUrl,
        username: profile.username,
        phone: profile.phone,
        email: profile.email,
        timezone: normalizeTimezone(profile.timezone)
      },
      syncMeta: {
        lastImportAt: syncMeta.lastImportAt,
        count: syncMeta.count
      },
      readingStates: readAllStoredStatuses(),
      annotationsBySlug: readLocalAnnotationsBySlug()
    };

    const json = JSON.stringify(payload, null, 2);
    const stamp = payload.exportedAt.replace(/[:.]/g, "-");
    const fileName = `qinginvest-local-backup-${stamp}.json`;
    downloadTextAsFile(fileName, json);

    const statusCount = Object.keys(payload.readingStates).length;
    const annotationCount = Object.values(payload.annotationsBySlug).reduce((sum, items) => sum + items.length, 0);
    setBanner({ tone: "success", text: `备份已导出（状态 ${statusCount}，批注 ${annotationCount}）` });
  };

  const importLocalBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.size > LOCAL_BACKUP_MAX_BYTES) {
      setBanner({ tone: "warn", text: "备份文件过大（超过 8MB），请确认文件是否正确" });
      return;
    }

    setBackupBusy(true);
    try {
      const raw = await file.text();
      const parsed = parseLocalBackup(raw);
      if (!parsed.ok) {
        setBanner({ tone: "warn", text: parsed.error });
        return;
      }

      const data = parsed.data;
      const statusCount = Object.keys(data.readingStates).length;
      const annotationCount = Object.values(data.annotationsBySlug).reduce((sum, items) => sum + items.length, 0);
      setBackupPreview({
        fileName: file.name,
        payload: data,
        statusCount,
        annotationCount
      });
      setBanner({
        tone: "success",
        text: `备份已读取，请确认导入（状态 ${statusCount}，批注 ${annotationCount}）`
      });
    } catch (error) {
      setBanner({ tone: "warn", text: `备份导入失败：${formatErrorMessage(error)}` });
    } finally {
      setBackupBusy(false);
    }
  };

  const confirmImportBackup = () => {
    if (!backupPreview) {
      setBanner({ tone: "warn", text: "请先选择备份文件" });
      return;
    }

    const previewTime = backupPreview.payload.exportedAt
      ? backupPreview.payload.exportedAt.replace("T", " ").slice(0, 19)
      : "未知";
    const confirmed = window.confirm(
      `确认导入备份（${backupPreview.fileName}）？将覆盖当前本地资料与阅读数据。\n导出时间：${previewTime}\n状态：${backupPreview.statusCount}\n批注：${backupPreview.annotationCount}`
    );
    if (!confirmed) return;

    setBackupBusy(true);
    try {
      applyLocalBackup(backupPreview.payload);
      setBanner({
        tone: "success",
        text: `备份导入完成（状态 ${backupPreview.statusCount}，批注 ${backupPreview.annotationCount}）`
      });
      setBackupPreview(null);
    } finally {
      setBackupBusy(false);
    }
  };

  const applyLocalBackup = (payload: LocalBackupPayload) => {
    if (typeof window === "undefined") return;

    const keysToDelete: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(STATUS_PREFIX) || key.startsWith(ANNOTATION_PREFIX)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      window.localStorage.removeItem(key);
    }

    for (const [slug, status] of Object.entries(payload.readingStates)) {
      if (!slug.trim()) continue;
      window.localStorage.setItem(`${STATUS_PREFIX}${slug}`, normalizeStateStatus(status));
    }

    for (const [slug, items] of Object.entries(payload.annotationsBySlug)) {
      if (!slug.trim()) continue;
      window.localStorage.setItem(`${ANNOTATION_PREFIX}${slug}`, JSON.stringify(normalizeAnnotationArray(items)));
    }

    const nextMeta: SyncMeta = {
      lastImportAt: payload.syncMeta.lastImportAt,
      count: payload.syncMeta.count
    };
    window.localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(nextMeta));
    setSyncMeta(nextMeta);

    writeUserProfile({
      avatarDataUrl: payload.profile.avatarDataUrl,
      username: payload.profile.username,
      phone: payload.profile.phone,
      email: payload.profile.email,
      timezone: normalizeTimezone(payload.profile.timezone)
    });
    loadLocalProfile();
    refreshLocalStats();
    refreshSyncHealth();

    window.dispatchEvent(
      new CustomEvent(ARTICLE_STATE_CHANGED_EVENT, {
        detail: { source: "backup-import" }
      })
    );
    window.dispatchEvent(
      new CustomEvent(ARTICLE_ANNOTATIONS_CHANGED_EVENT, {
        detail: { source: "backup-import" }
      })
    );
  };

  const exportSyncDiagnostics = () => {
    if (typeof window === "undefined") return;

    const events = readSyncMetricEvents(24).slice(0, SYNC_DIAGNOSTIC_EVENT_LIMIT);
    const report = {
      version: 1,
      exportedAt: new Date().toISOString(),
      windowHours: 24,
      timezone: normalizeTimezone(profile.timezone),
      summary: syncHealth,
      localStats: syncStats,
      syncMeta,
      auth: {
        loggedIn: Boolean(authUser),
        userId: authUser?.id || "",
        email: normalizeText(authUser?.email),
        phone: normalizeText(authUser?.phone)
      },
      events: events.map((item) => ({
        ...item,
        atIso: new Date(item.at).toISOString()
      }))
    };

    const json = JSON.stringify(report, null, 2);
    const stamp = report.exportedAt.replace(/[:.]/g, "-");
    downloadTextAsFile(`qinginvest-sync-diagnostics-${stamp}.json`, json);
    setBanner({
      tone: "success",
      text: `同步诊断已导出（24h 事件 ${events.length} 条）`
    });
  };

  const clearSyncDiagnostics = () => {
    if (typeof window === "undefined") return;
    const confirmed = window.confirm("确认清空本地同步诊断记录吗？");
    if (!confirmed) return;
    clearSyncMetricEvents();
    refreshSyncHealth();
    setBanner({ tone: "warn", text: "同步诊断记录已清空" });
  };

  const syncLocalToAccount = useCallback(
    async (userId: string, options?: { silent?: boolean }) => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        throw new Error("Supabase 客户端不可用");
      }

      const articleStates = readAllStoredStatuses();
      const annotationsBySlug = readLocalAnnotationsBySlug();
      const localCount =
        Object.keys(articleStates).length +
        Object.values(annotationsBySlug).reduce(
          (sum, items) => sum + items.length,
          0
        );

      if (localCount === 0) {
        if (!options?.silent) {
          setBanner({ tone: "warn", text: "本地没有可导入的数据" });
        }
        return { count: 0 };
      }

      const slugs = dedupe([
        ...Object.keys(articleStates),
        ...Object.keys(annotationsBySlug)
      ]);
      const slugToId = await fetchArticleIdMap(supabase, slugs);

      const statePayload = [];
      for (const [slug, status] of Object.entries(articleStates)) {
        const articleId = slugToId.get(slug);
        if (!articleId) continue;
        statePayload.push({
          user_id: userId,
          article_id: articleId,
          status: normalizeStateStatus(status)
        });
      }

      for (const chunk of chunkArray(statePayload, 200)) {
        const { error } = await supabase
          .from("reading_states")
          .upsert(chunk, { onConflict: "user_id,article_id" });
        if (error) throw error;
      }

      const annotationPayload = [];
      const annotationArticleIds = [];
      for (const [slug, items] of Object.entries(annotationsBySlug)) {
        const articleId = slugToId.get(slug);
        if (!articleId) continue;
        annotationArticleIds.push(articleId);

        for (const item of items) {
          annotationPayload.push({
            user_id: userId,
            article_id: articleId,
            kind: item.kind === "quote" ? "quote" : "annotation",
            quote: item.quote.slice(0, 800),
            note: item.note || "",
            source_meta: {
              source: "local-storage",
              local_id: item.id,
              article_slug: slug
            },
            created_at: normalizeIsoDate(item.createdAt)
          });
        }
      }

      const articleIds = dedupe(annotationArticleIds);
      for (const chunk of chunkArray(articleIds, 100)) {
        const { error } = await supabase
          .from("annotations")
          .delete()
          .eq("user_id", userId)
          .in("article_id", chunk);
        if (error) throw error;
      }

      for (const chunk of chunkArray(annotationPayload, 200)) {
        const { error } = await supabase.from("annotations").insert(chunk);
        if (error) throw error;
      }

      const importedCount = statePayload.length + annotationPayload.length;
      const nowIso = new Date().toISOString();
      const nextMeta: SyncMeta = {
        lastImportAt: Date.now(),
        count: importedCount
      };

      const { error: metaError } = await supabase
        .from("user_sync_meta")
        .upsert(
          {
            user_id: userId,
            last_import_at: nowIso,
            last_import_count: importedCount
          },
          { onConflict: "user_id" }
        );
      if (metaError) throw metaError;

      setSyncMeta(nextMeta);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(nextMeta));
      }

      if (!options?.silent) {
        const unresolved = slugs.length - slugToId.size;
        const suffix = unresolved > 0 ? `（${unresolved}篇未匹配到文章）` : "";
        setBanner({
          tone: "success",
          text: `已导入 ${importedCount} 条到账号${suffix}`
        });
      }

      return { count: importedCount };
    },
    []
  );

  const onClickSyncToAccount = async () => {
    if (!authUser || !supabaseEnabled) {
      setBanner({ tone: "warn", text: "请先登录账号后再导入" });
      return;
    }

    setSyncBusy(true);
    try {
      await syncLocalToAccount(authUser.id);
    } catch (error) {
      setBanner({
        tone: "warn",
        text: `导入失败：${formatErrorMessage(error)}`
      });
    } finally {
      setSyncBusy(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authUser || !supabaseEnabled) return;
    if (syncMeta.lastImportAt) return;
    if (syncStats.totalLocalEntries <= 0) return;

    const promptKey = `${LOCAL_IMPORT_PROMPT_PREFIX}${authUser.id}`;
    if (window.localStorage.getItem(promptKey) === "1") return;
    window.localStorage.setItem(promptKey, "1");

    const confirmed = window.confirm(
      `检测到本地有 ${syncStats.totalLocalEntries} 条阅读/批注数据，是否导入到当前账号？`
    );
    if (!confirmed) return;

    setSyncBusy(true);
    void syncLocalToAccount(authUser.id, { silent: false })
      .catch((error) => {
        setBanner({
          tone: "warn",
          text: `自动导入失败：${formatErrorMessage(error)}`
        });
      })
      .finally(() => {
        setSyncBusy(false);
      });
  }, [
    authUser,
    supabaseEnabled,
    syncMeta.lastImportAt,
    syncStats.totalLocalEntries,
    syncLocalToAccount
  ]);

  return (
    <div className="settings-screen">
      <section className="settings-intro">
        <h1>用户设置</h1>
        <p>管理通知方式、手机号与时区偏好。</p>
      </section>

      <section className="settings-panel">
        <header className="settings-panel-title">
          <span className="settings-panel-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <rect x="5" y="8" width="10" height="8" rx="1.8" />
              <path d="M7 8V6.3A3 3 0 0 1 10 3.4a3 3 0 0 1 3 2.9V8" />
            </svg>
          </span>
          <h2>账号设置</h2>
        </header>

        <section className="settings-auth-box">
          <p className="settings-auth-title">
            {AUTH_LOGIN_ENABLED
              ? `登录与认证（邮箱 OTP${PHONE_OTP_ENABLED ? " + 手机号 OTP" : "，手机号待开通"}）`
              : "登录与认证（暂缓开发）"}
          </p>
          <p className="settings-auth-sub">当前状态：{authStatusText}</p>

          {!AUTH_LOGIN_ENABLED ? (
            <p className="settings-auth-sub" style={{ marginTop: 8 }}>
              邮箱/手机号登录已暂缓，当前版本先以本地模式继续开发与验收。
            </p>
          ) : authUser ? (
            <div className="settings-auth-actions">
              <button
                type="button"
                className="settings-action-btn"
                onClick={signOut}
                disabled={authBusy}
              >
                退出登录
              </button>
            </div>
          ) : (
            <>
              <div className="settings-auth-methods">
                <button
                  type="button"
                  className={`settings-auth-chip ${authMethod === "email" ? "active" : ""}`}
                  onClick={() => setAuthMethod("email")}
                >
                  邮箱
                </button>
                <button
                  type="button"
                  className={`settings-auth-chip ${authMethod === "phone" ? "active" : ""}`}
                  onClick={() => setAuthMethod("phone")}
                  disabled={!PHONE_OTP_ENABLED}
                  title={!PHONE_OTP_ENABLED ? "短信服务未配置，暂未开放手机号验证码登录" : undefined}
                >
                  手机号
                  {!PHONE_OTP_ENABLED ? <span className="settings-auth-chip-badge">待开通</span> : null}
                </button>
              </div>

              <div className="settings-auth-form">
                <input
                  className="settings-auth-input"
                  placeholder={
                    authMethod === "email"
                      ? "请输入邮箱，例如 user@example.com"
                      : "请输入手机号，例如 13800138000 或 +8613800138000"
                  }
                  value={authIdentifier}
                  onChange={(event) => setAuthIdentifier(event.target.value)}
                />
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={sendOtp}
                  disabled={authBusy}
                >
                  发送验证码
                </button>
              </div>

              <div className="settings-auth-form">
                <input
                  className="settings-auth-input"
                  placeholder={
                    otpChallenge
                      ? otpChallenge.method === "email"
                        ? "请输入6位邮箱验证码"
                        : "请输入发送到手机的验证码"
                      : "请先发送验证码"
                  }
                  value={otpCode}
                  inputMode={otpChallenge?.method === "email" ? "numeric" : "text"}
                  maxLength={otpChallenge?.method === "email" ? 6 : 12}
                  onChange={(event) => setOtpCode(event.target.value)}
                />
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={verifyOtpAndLogin}
                  disabled={authBusy}
                >
                  验证并登录
                </button>
              </div>
            </>
          )}
        </section>

        <div className="settings-rows">
          <article className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-icon avatar" aria-hidden="true">
                {profile.avatarDataUrl ? (
                  <img src={profile.avatarDataUrl} alt="头像" />
                ) : (
                  <svg viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="7" />
                    <circle cx="7.5" cy="9" r="0.9" />
                    <circle cx="12.5" cy="9" r="0.9" />
                    <path d="M7 12.1c.8.9 1.8 1.4 3 1.4s2.2-.5 3-1.4" />
                  </svg>
                )}
              </div>
              <div className="settings-row-copy">
                <p className="title">头像</p>
                <p className="sub">点击更换个性化头像</p>
              </div>
            </div>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => avatarInputRef.current?.click()}
            >
              更换
            </button>
          </article>

          <article className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <circle cx="10" cy="6.8" r="2.8" />
                  <path d="M5.2 15.4c1-2 2.7-3 4.8-3 2.1 0 3.8 1 4.8 3" />
                </svg>
              </div>
              <div className="settings-row-copy">
                <p className="title">用户名</p>
                <p className="sub">{usernameDisplay}</p>
              </div>
            </div>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => {
                void editTextField("username", "设置用户名", "用户名已清空");
              }}
            >
              设置
            </button>
          </article>

          <article className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <path d="M6 3.9c.5-.3 1.2-.2 1.6.2l1.5 1.6c.4.4.4 1.1.1 1.6l-.8 1.1a10.6 10.6 0 0 0 3.2 3.2l1.1-.8c.5-.3 1.2-.3 1.6.1l1.6 1.5c.4.4.5 1.1.2 1.6l-.7 1.2c-.3.5-.9.8-1.5.8h-.5A10.7 10.7 0 0 1 3 6.2v-.5c0-.6.3-1.2.8-1.5z" />
                </svg>
              </div>
              <div className="settings-row-copy">
                <p className="title">手机号</p>
                <p className="sub">{phoneDisplay}</p>
              </div>
            </div>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => {
                void editTextField("phone", "更新手机号资料字段", "手机号资料已清空");
              }}
            >
              更换
            </button>
          </article>

          <article className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <rect x="2.8" y="4.6" width="14.4" height="10.8" rx="1.8" />
                  <path d="m3.8 6 6.2 4.6L16.2 6" />
                </svg>
              </div>
              <div className="settings-row-copy">
                <p className="title">邮箱</p>
                <p className="sub">{emailDisplay}</p>
              </div>
            </div>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => {
                void editTextField("email", "更新邮箱资料字段", "邮箱资料已清空");
              }}
            >
              绑定
            </button>
          </article>

          <article className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <path d="M8.2 11.8 6 14a2.2 2.2 0 1 0 3.1 3.1l2.2-2.2" />
                  <path d="m11.8 8.2 2.2-2.2A2.2 2.2 0 0 0 10.9 2.9L8.7 5.1" />
                  <path d="m7.9 12.1 4.2-4.2" />
                </svg>
              </div>
              <div className="settings-row-copy">
                <p className="title">登录密码</p>
                <p className="sub">当前采用邮箱/手机号验证码登录（OTP）</p>
              </div>
            </div>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() =>
                setBanner({
                  tone: "warn",
                  text: "密码模式后续可加；当前已支持邮箱/手机号验证码登录"
                })
              }
            >
              说明
            </button>
          </article>

          <article className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="7" />
                  <path d="M10 6.2v4l2.6 1.6" />
                </svg>
              </div>
              <div className="settings-row-copy">
                <p className="title">时区</p>
                <p className="sub">{timezoneLabel}</p>
              </div>
            </div>
            <label className="settings-select-wrap">
              <select value={profile.timezone} onChange={onTimezoneChange}>
                {TIMEZONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="settings-select-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <path d="m5 7.5 5 5 5-5" />
                </svg>
              </span>
            </label>
          </article>

          <article className="settings-row sync-row">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <path d="M3.5 4.6h5.8v10.8H3.5z" />
                  <path d="M10.7 4.6h5.8v10.8h-5.8z" />
                  <path d="M9.3 6.2c.6-.3 1.2-.5 2-.5" />
                </svg>
              </div>
              <div className="settings-row-copy">
                <p className="title">阅读状态同步</p>
                <p className="sub">
                  本地数据：待阅 {syncStats.unread} · 已读 {syncStats.read} · 浏览 {syncStats.viewed} ·
                  批注 {syncStats.annotations}
                </p>
                <p className="sub">上次导入：{formatSyncMeta(syncMeta, profile.timezone)}</p>
                <p className="sub">
                  同步健康（24h）：{syncHealth.total} 次 · 失败 {syncHealth.failed} 次 · 平均{" "}
                  {syncHealth.averageDurationMs}ms
                  {syncHealth.lastFailureAt
                    ? ` · 最近失败 ${formatTimestamp(syncHealth.lastFailureAt, profile.timezone)}`
                    : ""}
                </p>
              </div>
            </div>
            <div className="settings-inline-actions">
              <button
                type="button"
                className="settings-action-btn"
                onClick={clearLocalReadingData}
                disabled={syncBusy || backupBusy}
              >
                清除本地
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={onClickSyncToAccount}
                disabled={syncBusy || backupBusy}
              >
                {syncBusy ? "导入中..." : "导入到账号"}
              </button>
            </div>
          </article>

          <article className="settings-row sync-row">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <rect x="3" y="4.2" width="14" height="11.6" rx="1.8" />
                  <path d="M6.5 7.5h7M6.5 10h7M6.5 12.5h4.6" />
                </svg>
              </div>
              <div className="settings-row-copy">
                <p className="title">本地数据备份</p>
                <p className="sub">导出/导入用户资料、阅读状态与批注（导入会覆盖当前本地数据）</p>
                <p className="sub">建议升级前先导出，跨设备可直接导入恢复</p>
                {backupPreview ? (
                  <p className="sub settings-backup-preview">
                    已加载：<strong>{backupPreview.fileName}</strong>（状态 {backupPreview.statusCount} · 批注{" "}
                    {backupPreview.annotationCount}）
                  </p>
                ) : null}
              </div>
            </div>
            <div className="settings-inline-actions">
              <button
                type="button"
                className="settings-action-btn"
                onClick={exportLocalBackup}
                disabled={syncBusy || backupBusy}
              >
                导出备份
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => backupInputRef.current?.click()}
                disabled={syncBusy || backupBusy}
              >
                {backupBusy ? "导入中..." : "导入备份"}
              </button>
              {backupPreview ? (
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={confirmImportBackup}
                  disabled={syncBusy || backupBusy}
                >
                  确认导入
                </button>
              ) : null}
              {backupPreview ? (
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={() => setBackupPreview(null)}
                  disabled={syncBusy || backupBusy}
                >
                  取消
                </button>
              ) : null}
            </div>
          </article>

          <article className="settings-row sync-row">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <path d="M10 2.8a7.2 7.2 0 1 0 7.2 7.2A7.2 7.2 0 0 0 10 2.8z" />
                  <path d="M10 6v4.2l2.6 2.1" />
                </svg>
              </div>
              <div className="settings-row-copy">
                <p className="title">同步诊断报告</p>
                <p className="sub">导出最近 24 小时同步事件（状态/批注）用于排错与验收记录</p>
                <p className="sub">
                  当前：总 {syncHealth.total} 次 · 失败 {syncHealth.failed} 次 · 平均 {syncHealth.averageDurationMs}ms
                </p>
              </div>
            </div>
            <div className="settings-inline-actions">
              <button
                type="button"
                className="settings-action-btn"
                onClick={exportSyncDiagnostics}
                disabled={syncBusy || backupBusy}
              >
                导出诊断
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={clearSyncDiagnostics}
                disabled={syncBusy || backupBusy}
              >
                清空诊断
              </button>
            </div>
          </article>
        </div>
      </section>

      {banner ? <p className={`settings-toast ${banner.tone}`}>{banner.text}</p> : null}

      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="settings-hidden-input"
        onChange={onAvatarFileChange}
      />
      <input
        ref={backupInputRef}
        type="file"
        accept="application/json,.json"
        className="settings-hidden-input"
        onChange={importLocalBackup}
      />
    </div>
  );
}

function normalizeTimezone(value: string | null | undefined): string {
  if (!value) return DEFAULT_PROFILE.timezone;
  if (TIMEZONE_OPTIONS.some((option) => option.value === value)) return value;
  if (LEGACY_TIMEZONE_MAP[value]) return LEGACY_TIMEZONE_MAP[value];
  return DEFAULT_PROFILE.timezone;
}

function getTimezoneLabel(value: string): string {
  const option = TIMEZONE_OPTIONS.find(
    (item) => item.value === normalizeTimezone(value)
  );
  return option ? option.label : TIMEZONE_OPTIONS[0].label;
}

function safeParseObject<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as T;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeParseAnnotationArray(raw: string | null): ArticleAnnotation[] {
  if (!raw) return [];

  try {
    return normalizeAnnotationArray(JSON.parse(raw));
  } catch {
    return [];
  }
}

function normalizeAnnotationArray(value: unknown): ArticleAnnotation[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Partial<ArticleAnnotation>;
      if (typeof row.quote !== "string" || !row.quote.trim()) return null;

      return {
        id:
          typeof row.id === "string" && row.id
            ? row.id
            : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        quote: row.quote.trim().slice(0, 800),
        note: typeof row.note === "string" ? row.note.trim() : "",
        createdAt:
          typeof row.createdAt === "string" && row.createdAt
            ? row.createdAt
            : new Date().toISOString(),
        kind: row.kind === "quote" ? "quote" : "annotation"
      } satisfies ArticleAnnotation;
    })
    .filter((item): item is ArticleAnnotation => Boolean(item));
}

function parseLocalBackup(raw: string): { ok: true; data: LocalBackupPayload } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "备份文件不是有效 JSON" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "备份内容格式不正确" };
  }

  const row = parsed as Partial<LocalBackupPayload>;
  const version = Number(row.version);
  if (!Number.isFinite(version) || version !== LOCAL_BACKUP_VERSION) {
    return { ok: false, error: "备份版本不支持，请使用当前站点重新导出后再导入" };
  }

  const profileRaw = (row.profile || {}) as Partial<UserProfile>;
  const profile: UserProfile = {
    avatarDataUrl: typeof profileRaw.avatarDataUrl === "string" ? profileRaw.avatarDataUrl : "",
    username: typeof profileRaw.username === "string" ? profileRaw.username : "",
    phone: typeof profileRaw.phone === "string" ? profileRaw.phone : "",
    email: typeof profileRaw.email === "string" ? profileRaw.email : "",
    timezone: normalizeTimezone(
      typeof profileRaw.timezone === "string" ? profileRaw.timezone : DEFAULT_PROFILE.timezone
    )
  };

  const metaRaw = (row.syncMeta || {}) as Partial<SyncMeta>;
  const syncMeta: SyncMeta = {
    lastImportAt:
      typeof metaRaw.lastImportAt === "number" && Number.isFinite(metaRaw.lastImportAt)
        ? metaRaw.lastImportAt
        : null,
    count: typeof metaRaw.count === "number" && Number.isFinite(metaRaw.count) ? Math.max(0, Math.floor(metaRaw.count)) : 0
  };

  const statesRaw = row.readingStates;
  const readingStates: Record<string, ArticleUserStatus> = {};
  if (statesRaw && typeof statesRaw === "object" && !Array.isArray(statesRaw)) {
    for (const [slug, status] of Object.entries(statesRaw as Record<string, unknown>)) {
      const key = slug.trim();
      if (!key) continue;
      readingStates[key] = normalizeStateStatus(String(status ?? ""));
    }
  }

  const annotationsRaw = row.annotationsBySlug;
  const annotationsBySlug: Record<string, ArticleAnnotation[]> = {};
  if (annotationsRaw && typeof annotationsRaw === "object" && !Array.isArray(annotationsRaw)) {
    for (const [slug, items] of Object.entries(annotationsRaw as Record<string, unknown>)) {
      const key = slug.trim();
      if (!key) continue;
      annotationsBySlug[key] = normalizeAnnotationArray(items);
    }
  }

  return {
    ok: true,
    data: {
      version: LOCAL_BACKUP_VERSION,
      exportedAt: typeof row.exportedAt === "string" ? row.exportedAt : "",
      profile,
      syncMeta,
      readingStates,
      annotationsBySlug
    }
  };
}

function downloadTextAsFile(fileName: string, content: string): void {
  if (typeof window === "undefined") return;

  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(href);
}

function formatSyncMeta(meta: SyncMeta, timeZone: string): string {
  if (!meta.lastImportAt) return "暂无";

  const date = new Date(meta.lastImportAt);
  try {
    const stamp = new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);

    return `${stamp} · ${meta.count}条`;
  } catch {
    const fallback = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(
      date.getHours()
    ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(
      date.getSeconds()
    ).padStart(2, "0")}`;

    return `${fallback} · ${meta.count}条`;
  }
}

function formatTimestamp(timestamp: number, timeZone: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "时间未知";

  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function readLocalAnnotationsBySlug(): Record<string, ArticleAnnotation[]> {
  if (typeof window === "undefined") return {};

  const map: Record<string, ArticleAnnotation[]> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(ANNOTATION_PREFIX)) continue;

    const slug = key.slice(ANNOTATION_PREFIX.length).trim();
    if (!slug) continue;
    map[slug] = safeParseAnnotationArray(window.localStorage.getItem(key));
  }

  return map;
}

async function fetchArticleIdMap(
  supabase: SupabaseClient,
  slugs: string[]
): Promise<Map<string, number>> {
  const output = new Map<string, number>();

  for (const chunk of chunkArray(dedupe(slugs), 120)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("articles")
      .select("id, slug")
      .in("slug", chunk);

    if (error) throw error;

    for (const row of data || []) {
      const id = Number(row.id);
      const slug = normalizeText(row.slug);
      if (!slug || !Number.isFinite(id)) continue;
      output.set(slug, id);
    }
  }

  return output;
}

function normalizeStateStatus(value: string): "unread" | "read" | "favorite" {
  if (value === "read") return "read";
  if (value === "favorite") return "favorite";
  return "unread";
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const output: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function profileDateToMillis(value: unknown): number | null {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeIsoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhoneForOtp(value: string): string {
  const raw = value.replace(/\s+/g, "").trim();
  if (raw.startsWith("+")) return raw;
  if (/^1\d{10}$/.test(raw)) return `+86${raw}`;
  return raw;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value: string): boolean {
  return /^\+\d{6,15}$/.test(value);
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
