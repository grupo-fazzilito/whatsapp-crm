'use client';

/** JSON request to an app API route; throws Error(body.error) on failure. */
export async function api<T = Record<string, unknown>>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    cache: 'no-store',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

/** Runs `fn`, returning [result, null] or [null, error message]. */
export async function attempt<T>(fn: () => Promise<T>): Promise<[T, null] | [null, string]> {
  try {
    return [await fn(), null];
  } catch (err) {
    return [null, err instanceof Error ? err.message : String(err)];
  }
}
