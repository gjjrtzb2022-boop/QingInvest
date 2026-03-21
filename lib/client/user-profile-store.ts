export type UserProfile = {
  avatarDataUrl: string;
  username: string;
  phone: string;
  email: string;
  timezone: string;
};

export const USER_PROFILE_STORAGE_KEY = "user-settings-profile-v1";
export const USER_PROFILE_UPDATED_EVENT = "user-profile-updated";

export function readUserProfile(): UserProfile | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(USER_PROFILE_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    if (!parsed || typeof parsed !== "object") return null;

    return {
      avatarDataUrl: typeof parsed.avatarDataUrl === "string" ? parsed.avatarDataUrl : "",
      username: typeof parsed.username === "string" ? parsed.username : "",
      phone: typeof parsed.phone === "string" ? parsed.phone : "",
      email: typeof parsed.email === "string" ? parsed.email : "",
      timezone: typeof parsed.timezone === "string" ? parsed.timezone : "Asia/Shanghai"
    };
  } catch {
    return null;
  }
}

export function writeUserProfile(profile: UserProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new CustomEvent(USER_PROFILE_UPDATED_EVENT, { detail: profile }));
}
