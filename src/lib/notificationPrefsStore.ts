// Persistent notification preferences — stored in localStorage

const STORAGE_KEY = 'westron_notif_prefs';

export interface NotificationPrefs {
  discordWebhook: string;   // global default Discord webhook URL
  quietFrom: string;        // e.g. "22:00"
  quietTo: string;          // e.g. "08:00"
}

const DEFAULT_PREFS: NotificationPrefs = {
  discordWebhook: '',
  quietFrom: '22:00',
  quietTo: '08:00',
};

export function loadNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}
