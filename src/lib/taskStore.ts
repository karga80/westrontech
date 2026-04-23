export interface StoredTask {
  id: string;
  iconChar: string;
  iconBg: string;
  label: string;
  meta: string;
  status: 'Pending' | 'Processing' | 'Scheduled' | 'Finished' | 'Failed';
  tab: 'Pending' | 'Scheduled' | 'Finished';
  aiGenerated?: boolean;
}

const KEY = 'westron_tasks';

export function loadStoredTasks(): StoredTask[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function persistTask(task: StoredTask): void {
  if (typeof window === 'undefined') return;
  const existing = loadStoredTasks();
  localStorage.setItem(KEY, JSON.stringify([task, ...existing]));
}

export function removeStoredTask(id: string): void {
  if (typeof window === 'undefined') return;
  const existing = loadStoredTasks().filter(t => t.id !== id);
  localStorage.setItem(KEY, JSON.stringify(existing));
}
