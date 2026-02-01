import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
export async function webSearch(query, options = {}) {
    const count = options.count ?? 5;
    const braveKey = process.env.BRAVE_API_KEY;
    const results = braveKey ? await braveSearch(query, count, braveKey) : await duckDuckGoSearch(query, count);
    const shouldFetch = options.fetch ?? true;
    if (!shouldFetch || results.length === 0) {
        return { results };
    }
    const fetchCount = Math.min(options.fetchCount ?? Math.min(3, results.length), results.length);
    const maxChars = options.maxChars ?? 20000;
    const fetched = [];
    for (const result of results.slice(0, fetchCount)) {
        try {
            const data = await webFetch(result.url, maxChars);
            fetched.push(data);
        }
        catch (err) {
            fetched.push({
                url: result.url,
                title: result.title,
                text: "",
                error: err.message
            });
        }
    }
    return { results, fetched };
}
async function braveSearch(query, count, apiKey) {
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
    const data = (await response.json());
    const results = data.web?.results ?? [];
    return results.slice(0, count).map((result) => ({
        title: result.title ?? "",
        url: result.url ?? "",
        snippet: result.description ?? ""
    }));
}
async function duckDuckGoSearch(query, count) {
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
    const results = [];
    for (const item of items) {
        const link = item.querySelector("a.result__a");
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
export async function webFetch(url, maxChars = 20000) {
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
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;
    const title = document.title || undefined;
    const reader = new Readability(document);
    const article = reader.parse();
    const rawText = article?.textContent || document.body?.textContent || "";
    const normalized = rawText.replace(/\s+/g, " ").trim();
    const text = normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized;
    return { url, title, text };
}
