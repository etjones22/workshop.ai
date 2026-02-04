import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOptions {
  count?: number;
  fetch?: boolean;
  fetchCount?: number;
  maxChars?: number;
}

export interface WebSearchResponse {
  results: WebSearchResult[];
  fetched?: Array<{ url: string; title?: string; text: string; error?: string }>;
}

export async function webSearch(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
  const count = options.count ?? 5;
  const braveKey = process.env.BRAVE_API_KEY;
  const results = braveKey ? await braveSearch(query, count, braveKey) : await duckDuckGoSearch(query, count);

  const shouldFetch = options.fetch ?? true;
  if (!shouldFetch || results.length === 0) {
    return { results };
  }

  const fetchCount = Math.min(options.fetchCount ?? Math.min(3, results.length), results.length);
  const maxChars = options.maxChars ?? 20000;
  const fetched: Array<{ url: string; title?: string; text: string; error?: string }> = [];

  for (const result of results.slice(0, fetchCount)) {
    try {
      const data = await webFetch(result.url, maxChars);
      fetched.push(data);
    } catch (err) {
      fetched.push({
        url: result.url,
        title: result.title,
        text: "",
        error: (err as Error).message
      });
    }
  }

  return { results, fetched };
}

async function braveSearch(query: string, count: number, apiKey: string): Promise<WebSearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
      "User-Agent": "Workshop.AI/0.1"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Brave search error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  const results = data.web?.results ?? [];
  return results.slice(0, count).map((result) => ({
    title: result.title ?? "",
    url: result.url ?? "",
    snippet: result.description ?? ""
  }));
}

async function duckDuckGoSearch(query: string, count: number): Promise<WebSearchResult[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Workshop.AI/0.1",
      Accept: "text/html"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DuckDuckGo search error ${response.status}: ${text}`);
  }

  const html = await response.text();
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const items = Array.from(document.querySelectorAll(".result"));
  const results: WebSearchResult[] = [];

  for (const item of items) {
    const link = item.querySelector("a.result__a") as HTMLAnchorElement | null;
    if (!link?.href) {
      continue;
    }
    const snippet = item.querySelector(".result__snippet")?.textContent?.trim() ?? "";
    results.push({
      title: link.textContent?.trim() ?? "",
      url: link.href,
      snippet
    });
    if (results.length >= count) {
      break;
    }
  }

  return results;
}

export async function webFetch(url: string, maxChars = 20000): Promise<{ url: string; title?: string; text: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Workshop.AI/0.1",
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fetch error ${response.status}: ${text}`);
  }

  const html = await response.text();
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (err) => {
    const message = String(err);
    if (message.includes("Could not parse CSS stylesheet")) {
      return;
    }
    console.warn(message);
  });
  const dom = new JSDOM(html, { url, virtualConsole });
  const document = dom.window.document;
  const title = document.title || undefined;

  const reader = new Readability(document);
  const article = reader.parse();
  const rawText = article?.textContent || document.body?.textContent || "";
  const normalized = rawText.replace(/\s+/g, " ").trim();
  const text = normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized;

  return { url, title, text };
}
