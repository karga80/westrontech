export interface AddressEntry {
  id: string;
  name: string;
  address: string;
  note?: string;
  createdAt: number;
}

const KEY = 'westron_address_book';

export function loadAddressBook(): AddressEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveAddressEntry(entry: AddressEntry): void {
  if (typeof window === 'undefined') return;
  const existing = loadAddressBook().filter(e => e.id !== entry.id);
  localStorage.setItem(KEY, JSON.stringify([entry, ...existing]));
}

export function deleteAddressEntry(id: string): void {
  if (typeof window === 'undefined') return;
  const existing = loadAddressBook().filter(e => e.id !== id);
  localStorage.setItem(KEY, JSON.stringify(existing));
}

export function updateAddressEntry(id: string, patch: Partial<Pick<AddressEntry, 'name' | 'note'>>): void {
  if (typeof window === 'undefined') return;
  const entries = loadAddressBook().map(e => e.id === id ? { ...e, ...patch } : e);
  localStorage.setItem(KEY, JSON.stringify(entries));
}
