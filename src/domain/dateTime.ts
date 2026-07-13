export function formatLocalDateTime(localDate: string, localTime?: string): string {

  const date = localDate.slice(0, 10).replaceAll('-', '.');
  const time = /^\d{2}:\d{2}$/.test(localTime ?? '') ? localTime : undefined;

  return time ? `${date} · ${time}` : date;
}
