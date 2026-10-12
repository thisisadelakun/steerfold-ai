import { normalizeCurrency, validateFxResponse } from "../../app/js/fx-validation.js";

function json(body, status = 200, cacheable = false, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Netlify-CDN-Cache-Control": cacheable
        ? "public, durable, max-age=14400, stale-while-revalidate=3600" : "no-store",
      "Netlify-Vary": "query=base|quote",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export default async function fxRate(request) {
  if (request.method !== "GET") return json({ error: "Only GET requests are supported." }, 405, false, { Allow: "GET" });
  const params = new URL(request.url).searchParams;
  const base = normalizeCurrency(params.get("base"));
  const quote = normalizeCurrency(params.get("quote"));
  if (!base || !quote || params.getAll("base").length !== 1 || params.getAll("quote").length !== 1) {
    return json({ error: "Provide one supported base and quote currency: CAD, USD, GBP or EUR." }, 400);
  }
  if (base === quote) {
    return json({ base, quote, rate: 1, rateDate: null, provider: null, fetchedAt: new Date().toISOString() });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.frankfurter.dev/v2/rate/${base}/${quote}`, {
      headers: { Accept: "application/json" }, signal: controller.signal,
    });
    if (!response.ok) return json({ error: "The reference exchange rate is currently unavailable." }, 502);
    const upstream = await response.json();
    const result = validateFxResponse({
      base: upstream.base, quote: upstream.quote, rate: upstream.rate,
      rateDate: upstream.date, provider: "Frankfurter", fetchedAt: new Date().toISOString(),
    }, base, quote);
    return json(result, 200, true);
  } catch {
    return json({ error: controller.signal.aborted
      ? "The exchange-rate provider timed out." : "A verified reference exchange rate could not be loaded." },
    controller.signal.aborted ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
}
