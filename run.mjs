// Fetches public spot market data and sends it, signed, to the address in the ENDPOINT secret.
// Uses Node built-ins only. Prints only "ok" or a short error code.

import { createHash, createHmac, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { collect, HOSTS, VENUES } from "./venues.mjs";

const BINANCE_API = "https://data-api.binance.vision/api/v3";
const ALLOWED_QUOTES = new Set(["USDT", "USDC", "USD"]);
const REQUEST_TIMEOUT_MS = 20_000;

async function fetchJson(url, init = {}) {
  const headers = {
    accept: "application/json",
    ...(init.body ? { "content-type": "application/json" } : {}),
  };

  const response = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`source-${response.status}`);
  return response.json();
}

const fetchBinance = (path) => fetchJson(`${BINANCE_API}${path}`);

export function buildPairs(info, tickers) {
  const tickerBySymbol = new Map(tickers.map((t) => [t.symbol, t]));
  const pairs = [];

  for (const symbolInfo of info.symbols) {
    const ticker = tickerBySymbol.get(symbolInfo.symbol);
    if (!ticker || !ALLOWED_QUOTES.has(symbolInfo.quoteAsset) || symbolInfo.isSpotTradingAllowed === false) {
      continue;
    }

    pairs.push([
      symbolInfo.symbol,
      symbolInfo.baseAsset,
      symbolInfo.quoteAsset,
      symbolInfo.status,
      ticker.lastPrice,
      ticker.quoteVolume,
      ticker.highPrice,
      ticker.lowPrice,
      ticker.openPrice,
    ]);
  }

  return pairs;
}

export function signedHeaders(signingKey, body) {
  const [kid, key] = signingKey.split(":");
  if (!kid || !key) throw new Error("config");

  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(18).toString("base64url");
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const payload = `${kid}\n${timestamp}\n${nonce}\n${bodyHash}`;

  const signature = createHmac("sha256", Buffer.from(key, "base64url"))
    .update(payload)
    .digest("hex");

  return {
    "content-type": "application/json",
    "x-key-id": kid,
    "x-timestamp": String(timestamp),
    "x-nonce": nonce,
    "x-signature": signature,
  };
}

async function fetchBinancePairs() {
  try {
    const [tickers, info] = await Promise.all([
      fetchBinance("/ticker/24hr"),
      fetchBinance("/exchangeInfo?permissions=SPOT"),
    ]);
    return buildPairs(info, tickers);
  } catch {
    return null;
  }
}

async function main() {
  const { ENDPOINT, SIGNING_KEY, MEMBER_ID, RUN_ID } = process.env;
  if (!ENDPOINT || !SIGNING_KEY || !MEMBER_ID) throw new Error("config");

  const [binancePairs, otherVenues] = await Promise.all([
    fetchBinancePairs(),
    collect(VENUES, HOSTS, fetchJson),
  ]);

  if (binancePairs === null && Object.keys(otherVenues.venues).length === 0) {
    throw new Error("sources");
  }

  const failed = binancePairs === null ? ["binance", ...otherVenues.failed] : otherVenues.failed;

  const body = JSON.stringify({
    v: 2,
    account: MEMBER_ID,
    run_id: String(RUN_ID ?? ""),
    fetched_at: new Date().toISOString(),
    pairs: binancePairs ?? [],
    venues: otherVenues.venues,
    failed,
  });

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: signedHeaders(SIGNING_KEY, body),
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`send-${response.status}`);
}

const isDirectExecution = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isDirectExecution) {
  main().then(
    () => console.log("ok"),
    (error) => {
      const code = error instanceof Error && /^[a-z]+(-\d+)?$/.test(error.message) ? error.message : "error";
      console.log(code);
      process.exitCode = 1;
    },
  );
}
