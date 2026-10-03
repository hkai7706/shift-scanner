export type ScanResponse = {
  shifts: {
    matchedName: string;
    date: string | null;
    start: string | null;
    end: string | null;
    breakMinutes: number | null;
    confidence: number;
    uncertainty: string;
  }[];
};
export async function scannerRequest<T>(
  endpoint: string,
  token: string,
  body?: unknown,
  language: "en" | "ja" = "en",
): Promise<T> {
  const ja = language === "ja";
  if (!token.trim())
    throw Error(
      ja
        ? "スキャナーのアクセス・トークンを貼り付けてください。OpenAI APIキーではありません。"
        : "Paste your scanner access token first. This is not your OpenAI API key.",
    );
  let url: URL;
  try {
    url = new URL(endpoint.trim());
    if (!["https:", "http:"].includes(url.protocol)) throw Error();
  } catch {
    throw Error(
      ja
        ? "設定のスキャナーURLを確認してください。"
        : "Check the scanner URL in Settings.",
    );
  }
  if (body === undefined) {
    url.pathname = url.pathname.replace(/\/$/, "") + "/health";
    url.search = "";
    url.hash = "";
  }
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    body === undefined ? 20000 : 90000,
  );
  let response: Response;
  try {
    response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.trim()}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
  } catch {
    throw Error(
      timedOut
        ? ja
          ? "スキャナーの応答がタイムアウトしました。時間をおいて再試行してください。"
          : "The scanner timed out. Try again shortly."
        : ja
          ? `スキャナーに接続できません。設定のURL、インターネット接続、このサイトからのアクセス許可を確認してください。サイト: ${location.origin} / スキャナー: ${url.origin}`
          : `Cannot reach the scanner. Check the URL in Settings, your internet connection, and whether this site is allowed by the backend. Page: ${location.origin} · Scanner: ${url.origin}`,
    );
  } finally {
    clearTimeout(timeout);
  }
  let result: Record<string, unknown>;
  try {
    result = await response.json();
  } catch {
    throw Error(
      ja
        ? `スキャナーが予期しない応答を返しました（${response.status}）。URLを確認してください。`
        : `The scanner returned an unexpected response (${response.status}). Check its URL in Settings.`,
    );
  }
  if (!response.ok) {
    if (response.status === 401)
      throw Error(
        ja
          ? "スキャナーのトークンが正しくありません。更新するとトークンが消えるため、再度貼り付けてください。"
          : "Scanner token is missing or incorrect. It is cleared on refresh; paste it again.",
      );
    if (response.status === 403)
      throw Error(
        ja
          ? "このサイトからのスキャンは許可されていません。GitHub Pagesのアプリを開いてください。"
          : "This page is not allowed to use the scanner. Open the GitHub Pages app or a configured local preview.",
      );
    throw Error(
      typeof result.error === "string"
        ? result.error
        : `Scanner error (${response.status})`,
    );
  }
  return result as T;
}
