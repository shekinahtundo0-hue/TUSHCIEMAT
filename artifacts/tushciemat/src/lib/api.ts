import { ApiError } from '@workspace/api-client-react';

// The API writes 4xx messages for end users; 5xx and network failures get the fallback.
export function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status < 500) {
    const message = (error.data as { error?: { message?: unknown } } | null)?.error?.message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

export function apiStatus(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}

/**
 * Today's calendar date in the school timezone (Africa/Nairobi).
 * IMPORTANT: This ensures consistency with backend date logic. Always use this
 * instead of todayLocal() for academic calendar, attendance, and date-sensitive operations.
 */
export function todayInSchoolTimezone(): string {
  const date = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Today's calendar date in browser timezone.
 * DEPRECATED: Use todayInSchoolTimezone() for academic/attendance logic.
 * Only use for display purposes that don't affect data.
 */
export function todayLocal(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatDate(value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return date.toLocaleDateString('en-KE', options);
}
