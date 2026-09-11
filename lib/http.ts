export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 10000): Promise<T> {
  const controller = init?.signal ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(url, {
      ...init,
      signal: init?.signal ?? controller?.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });

    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const message =
        typeof data === "object" && data !== null
          ? JSON.stringify(data)
          : String(data || response.statusText);
      throw new Error(`${response.status} ${message}`);
    }

    return data as T;
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || /aborted|timeout/i.test(error.message))) {
      throw new Error(`Tempo limite ao acessar ${new URL(url).hostname}`);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function ensureHttpUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
