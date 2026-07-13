export function formatLocalDateTime(localDate: string | undefined, localTime?: string): string {
  if (!localDate) return '';

  const date = localDate.slice(0, 10).replaceAll('-', '.');
  const time = /^\d{2}:\d{2}$/.test(localTime ?? '')
    ? localTime
    : localDate.match(/T(\d{2}:\d{2})/)?.[1];

  return time ? `${date} · ${time}` : date;
}
