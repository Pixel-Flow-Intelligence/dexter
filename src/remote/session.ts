function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatSessionName(date: Date, withSeconds = false): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const base = `dexter-${year}${month}${day}-${hour}${minute}`;
  if (!withSeconds) {
    return base;
  }
  return `${base}${pad2(date.getSeconds())}`;
}

export function uniqueSessionName(date: Date, existing: readonly string[]): string {
  const minuteName = formatSessionName(date);
  if (!existing.includes(minuteName)) {
    return minuteName;
  }

  const secondName = formatSessionName(date, true);
  if (!existing.includes(secondName)) {
    return secondName;
  }

  let suffix = 2;
  let candidate = `${secondName}-${suffix}`;
  while (existing.includes(candidate)) {
    suffix += 1;
    candidate = `${secondName}-${suffix}`;
  }
  return candidate;
}

export type AttachTarget =
  | { action: 'attach'; session: string }
  | { action: 'create' };

export function resolveAttachTarget(
  lastSession: string | null,
  liveSessions: readonly string[],
): AttachTarget {
  const last = lastSession?.trim() || null;
  if (last && liveSessions.includes(last)) {
    return { action: 'attach', session: last };
  }
  return { action: 'create' };
}
