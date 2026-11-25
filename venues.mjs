// --- Configuration ---

const VENUES_CONFIG = {
  venues: [
    { id: "okx", enabled: true, role: "primary", host: "https://www.okx.com", blocked_regions: [] },
    { id: "bybit", enabled: true, role: "primary", host: "https://api.bybit.com", blocked_regions: ["us"] },
    { id: "gate", enabled: true, role: "primary", host: "https://api.gateio.ws", blocked_regions: [] },
    { id: "bitget", enabled: true, role: "secondary", host: "https://api.bitget.com", blocked_regions: ["oc", "us", "eu"] },
    { id: "kraken", enabled: true, role: "secondary", host: "https://api.kraken.com", blocked_regions: [] },
    { id: "coinbase", enabled: true, role: "secondary", host: "https://api.exchange.coinbase.com", blocked_regions: [] },
    { id: "cryptocom", enabled: true, role: "secondary", host: "https://api.crypto.com", blocked_regions: [] },
    { id: "bitfinex", enabled: true, role: "secondary", host: "https://api-pub.bitfinex.com", blocked_regions: [] },
    { id: "bitstamp", enabled: true, role: "secondary", host: "https://www.bitstamp.net", blocked_regions: [] },
    { id: "hyperliquid", enabled: true, role: "secondary", host: "https://api.hyperliquid.xyz", blocked_regions: [] },
    { id: "mexc", enabled: true, role: "secondary", host: "https://api.mexc.com", blocked_regions: [] },
  ],
};

const THRESHOLDS_CONFIG = {
  methodology_version: 1,
  consolidation: {
    max_row_age_s: 180,
    max_spread_pct_for_mid: 1,
    min_row_volume_usd: 1e3,
    central_volume_pct: 80,
    max_volume_share: 0.5,
    confirm_move_pct: 30,
    min_venues: 2,
    quality_floor: 0.2,
    confirm_hold_minutes: 3,
    prior_max_age_min: 5,
  },
  primary: {
    order: "binance,okx,coinbase,bybit,bitget,gate,kucoin,mexc,kraken,cryptocom,bitfinex,bitstamp,hyperliquid",
    max_gap_pct: 3,
    promote_every_min: 60,
    direct_venues: "okx,coinbase,bybit,gate",
    github_venues: "binance,mexc,kraken,cryptocom,bitstamp,hyperliquid,bitfinex,bitget",
    github_max_age_s: 150,
    rear_every_min: 5,
  },
  lifecycle: {
    activate_min_volume_usd: 0,
    delist_after_missing_lists: 3,
    venue_list_change_guard_pct: 20,
    max_match_change_pct: 5,
    symbol_match_max_gap_pct: 1.5,
    symbol_match_confirm_runs: 2,
    listing_gate_enforce: 0,
    listing_hide_max_per_run: 100,
    listing_protect_min_venues: 4,
    listing_protect_min_volume_usd: 1e6,
    listing_min_listed_share_pct: 40,
    park_unlisted_below_usd: 1e3,
    low_liquidity_usd: 1e3,
  },
  supply_review_jump_pct: 5,
  review_top_n: 200,
  eco_dex: { enabled: true, per_chain: 200 },
  cmc_search: { enabled: true, daily_limit: 600, cache_minutes: 5 },
};

const SYMBOL_ALIASES = {
  kraken: { XBT: "BTC", XDG: "DOGE" },
  bitfinex: { UST: "USDT", UDC: "USDC", ALG: "ALGO" },
};

// --- Core Utilities & Arbitrary-Precision Decimal (big.js compatible) ---

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });
const own = (obj, key) => (obj != null && Object.hasOwn(obj, key) ? obj[key] : undefined);

const NUMERIC_RE = /^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
const STRICT_NUMBER_RE = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;

function parseBig(x, str) {
  if (!NUMERIC_RE.test(str)) throw Error("[big.js] Invalid number");
  x.s = str.startsWith("-") ? ((str = str.slice(1)), -1) : 1;

  let dotIdx = str.indexOf(".");
  if (dotIdx > -1) str = str.replace(".", "");

  const expIdx = str.search(/e/i);
  if (expIdx > 0) {
    if (dotIdx < 0) dotIdx = expIdx;
    dotIdx += +str.slice(expIdx + 1);
    str = str.slice(0, expIdx);
  } else if (dotIdx < 0) {
    dotIdx = str.length;
  }

  let start = 0;
  let end = str.length;
  while (start < end && str[start] === "0") start++;

  if (start === end) {
    x.c = [(x.e = 0)];
  } else {
    while (end > 0 && str[end - 1] === "0") end--;
    x.e = dotIdx - start - 1;
    x.c = [];
    for (let i = start; i < end; i++) x.c.push(+str[i]);
  }
}

class BigDecimal {
  static DP = 30;
  static RM = 2; // roundHalfEven
  static NE = -7;
  static PE = 21;

  constructor(value) {
    if (value instanceof BigDecimal) {
      this.s = value.s;
      this.e = value.e;
      this.c = value.c.slice();
    } else {
      const str = typeof value === "string" ? value : value === 0 && 1 / value < 0 ? "-0" : String(value);
      parseBig(this, str);
    }
  }

  times(other) {
    const y = new BigDecimal(other);
    const res = new BigDecimal(0);
    res.s = this.s === y.s ? 1 : -1;

    if (!this.c[0] || !y.c[0]) {
      res.c = [(res.e = 0)];
      return res;
    }

    let xc = this.c;
    let yc = y.c;
    let a = xc.length;
    let b = yc.length;
    res.e = this.e + y.e;

    if (a < b) {
      [xc, yc] = [yc, xc];
      [a, b] = [b, a];
    }

    const c = new Array(a + b).fill(0);
    for (let i = b; i--; ) {
      let carry = 0;
      let j = a + i;
      while (j > i) {
        const prod = c[j] + yc[i] * xc[j - i - 1] + carry;
        c[j--] = prod % 10;
        carry = (prod / 10) | 0;
      }
      c[j] = carry;
    }

    if (c[0]) ++res.e;
    else c.shift();
    while (c.length > 1 && c[c.length - 1] === 0) c.pop();
    res.c = c;
    return res;
  }

  toString() {
    const isExp = this.e <= BigDecimal.NE || this.e >= BigDecimal.PE;
    const isNonZero = !!this.c[0];
    let str = this.c.join("");
    const len = str.length;
    let e = this.e;

    if (isExp) {
      str = str[0] + (len > 1 ? "." + str.slice(1) : "") + (e < 0 ? "e" : "e+") + e;
    } else if (e < 0) {
      str = "0." + "0".repeat(-e - 1) + str;
    } else if (e > 0) {
      if (++e > len) str += "0".repeat(e - len);
      else if (e < len) str = str.slice(0, e) + "." + str.slice(e);
    } else if (len > 1) {
      str = str[0] + "." + str.slice(1);
    }

    return this.s < 0 && isNonZero ? "-" + str : str;
  }

  toJSON() {
    return this.toString();
  }
}

const decimal = (v) => new BigDecimal(v);

// --- Lightweight Schema Validators ---

const isStr = (v) => typeof v === "string";
const isNum = (v) => typeof v === "number" && !Number.isNaN(v);
const isBool = (v) => typeof v === "boolean";
const isNumeric = (v) => isStr(v) || isNum(v);
const isOptional = (fn) => (v) => v === undefined || fn(v);
const isNullable = (fn) => (v) => v === null || fn(v);
const isNullish = (fn) => (v) => v === null || v === undefined || fn(v);
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isRecord = (v) => typeof v === "object" && v !== null;

function filterRows(items, shape) {
  if (!Array.isArray(items)) return null;
  const entries = Object.entries(shape);
  const valid = [];

  for (const item of items) {
    if (!isObj(item)) continue;
    const row = {};
    let passed = true;

    for (const [key, check] of entries) {
      const hasKey = key in item;
      const val = hasKey ? item[key] : undefined;
      if (!check(val)) {
        passed = false;
        break;
      }
      if (hasKey) row[key] = val;
    }
    if (passed) valid.push(row);
  }
  return valid;
}

// --- Normalization & Ticker Assembly ---

function parsePositive(value) {
  if (typeof value === "number") {
    return value > 0 && Number.isFinite(value) ? decimal(value) : undefined;
  }
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return STRICT_NUMBER_RE.test(text) && Number(text) > 0 ? decimal(text) : undefined;
}

function normalizeSymbol(venue, raw) {
  const upper = raw.trim().toUpperCase();
  return own(own(SYMBOL_ALIASES, venue) ?? {}, upper) ?? upper;
}

function buildTickers(venue, rawRows, onlyPairs) {
  const out = [];
  for (const row of rawRows) {
    if (onlyPairs && !onlyPairs.has(row.pair)) continue;

    const last = parsePositive(row.last);
    if (!last) continue;

    const quoteVol = parsePositive(row.quoteVolume);
    const baseVol = parsePositive(row.baseVolume);
    const volumeUsd = quoteVol ?? (baseVol ? baseVol.times(last) : decimal(0));
    const bid = parsePositive(row.bid);
    const ask = parsePositive(row.ask);

    out.push({
      venue,
      pair: row.pair,
      base: normalizeSymbol(venue, row.base),
      quote: normalizeSymbol(venue, row.quote),
      last,
      volumeUsd,
      ...(bid ? { bid } : {}),
      ...(ask ? { ask } : {}),
    });
  }
  return out;
}

function joinByPair(list, ticks, getListKey, getTickKey) {
  const tickMap = new Map(ticks.map((t) => [getTickKey(t), t]));
  const joined = [];
  for (const item of list) {
    const tick = tickMap.get(getListKey(item));
    if (tick !== undefined) joined.push([item, tick]);
  }
  return joined;
}

// --- Exchange Adapters ---

const MEXC_ONLINE_STATUS = new Set(["1", "ENABLED", "TRADING"]);

function splitBitfinexSymbol(symbol) {
  if (!symbol.startsWith("t")) return undefined;
  const body = symbol.slice(1);
  if (body.includes(":")) {
    const [base, quote] = body.split(":");
    return base && quote ? [base, quote] : undefined;
  }
  return body.length > 3 ? [body.slice(0, -3), body.slice(-3)] : undefined;
}

const ADAPTERS = [
  {
    id: "okx",
    calls: [
      { name: "list", path: "/api/v5/public/instruments?instType=SPOT" },
      { name: "ticker", path: "/api/v5/market/tickers?instType=SPOT" },
    ],
    parse(payloads, only) {
      const list = isObj(payloads.list) ? filterRows(payloads.list.data, { instId: isStr, baseCcy: isStr, quoteCcy: isStr, state: isStr }) : null;
      if (!list) return fail("okx list: unexpected shape");

      const ticks = isObj(payloads.ticker)
        ? filterRows(payloads.ticker.data, { instId: isStr, last: isNumeric, bidPx: isOptional(isNumeric), askPx: isOptional(isNumeric), volCcy24h: isOptional(isNumeric) })
        : null;
      if (!ticks) return fail("okx ticker: unexpected shape");

      const live = list.filter((r) => r.state === "live");
      const rows = joinByPair(live, ticks, (r) => r.instId, (t) => t.instId).map(([r, t]) => ({
        pair: r.instId,
        base: r.baseCcy,
        quote: r.quoteCcy,
        last: t.last,
        bid: t.bidPx,
        ask: t.askPx,
        quoteVolume: t.volCcy24h,
      }));
      return ok(buildTickers("okx", rows, only));
    },
  },
  {
    id: "bybit",
    calls: [
      { name: "list", path: "/v5/market/instruments-info?category=spot&limit=1000" },
      { name: "ticker", path: "/v5/market/tickers?category=spot" },
    ],
    parse(payloads, only) {
      const list = isObj(payloads.list?.result)
        ? filterRows(payloads.list.result.list, { symbol: isStr, baseCoin: isStr, quoteCoin: isStr, status: isStr })
        : null;
      if (!list) return fail("bybit list: unexpected shape");

      const ticks = isObj(payloads.ticker?.result)
        ? filterRows(payloads.ticker.result.list, {
            symbol: isStr,
            lastPrice: isNumeric,
            bid1Price: isOptional(isNumeric),
            ask1Price: isOptional(isNumeric),
            turnover24h: isOptional(isNumeric),
          })
        : null;
      if (!ticks) return fail("bybit ticker: unexpected shape");

      const trading = list.filter((r) => r.status === "Trading");
      const rows = joinByPair(trading, ticks, (r) => r.symbol, (t) => t.symbol).map(([r, t]) => ({
        pair: r.symbol,
        base: r.baseCoin,
        quote: r.quoteCoin,
        last: t.lastPrice,
        bid: t.bid1Price,
        ask: t.ask1Price,
        quoteVolume: t.turnover24h,
      }));
      return ok(buildTickers("bybit", rows, only));
    },
  },
  {
    id: "gate",
    calls: [
      { name: "list", path: "/api/v4/spot/currency_pairs" },
      { name: "ticker", path: "/api/v4/spot/tickers" },
    ],
    parse(payloads, only) {
      const list = filterRows(payloads.list, { id: isStr, base: isStr, quote: isStr, trade_status: isStr, base_name: isOptional(isStr) });
      if (!list) return fail("gate list: unexpected shape");

      const ticks = filterRows(payloads.ticker, {
        currency_pair: isStr,
        last: isNumeric,
        highest_bid: isOptional(isNumeric),
        lowest_ask: isOptional(isNumeric),
        quote_volume: isOptional(isNumeric),
      });
      if (!ticks) return fail("gate ticker: unexpected shape");

      const tradable = list.filter((r) => r.trade_status === "tradable");
      const rows = joinByPair(tradable, ticks, (r) => r.id, (t) => t.currency_pair).map(([r, t]) => ({
        pair: r.id,
        base: r.base,
        quote: r.quote,
        last: t.last,
        bid: t.highest_bid,
        ask: t.lowest_ask,
        quoteVolume: t.quote_volume,
      }));
      return ok(buildTickers("gate", rows, only));
    },
  },
  {
    id: "bitget",
    calls: [
      { name: "list", path: "/api/v2/spot/public/symbols" },
      { name: "ticker", path: "/api/v2/spot/market/tickers" },
    ],
    parse(payloads, only) {
      const list = isObj(payloads.list) ? filterRows(payloads.list.data, { symbol: isStr, baseCoin: isStr, quoteCoin: isStr, status: isStr }) : null;
      if (!list) return fail("bitget list: unexpected shape");

      const ticks = isObj(payloads.ticker)
        ? filterRows(payloads.ticker.data, { symbol: isStr, lastPr: isNumeric, bidPr: isOptional(isNumeric), askPr: isOptional(isNumeric), quoteVolume: isOptional(isNumeric) })
        : null;
      if (!ticks) return fail("bitget ticker: unexpected shape");

      const online = list.filter((r) => r.status === "online");
      const rows = joinByPair(online, ticks, (r) => r.symbol, (t) => t.symbol).map(([r, t]) => ({
        pair: r.symbol,
        base: r.baseCoin,
        quote: r.quoteCoin,
        last: t.lastPr,
        bid: t.bidPr,
        ask: t.askPr,
        quoteVolume: t.quoteVolume,
      }));
      return ok(buildTickers("bitget", rows, only));
    },
  },
  {
    id: "kraken",
    calls: [
      { name: "list", path: "/0/public/AssetPairs" },
      { name: "ticker", path: "/0/public/Ticker" },
    ],
    parse(payloads, only) {
      const listRes = payloads.list?.result;
      const tickRes = payloads.ticker?.result;
      if (!isObj(listRes)) return fail("kraken list: unexpected shape");
      if (!isObj(tickRes)) return fail("kraken ticker: unexpected shape");

      const rows = [];
      for (const [key, pair] of Object.entries(listRes)) {
        if (!isObj(pair) || !isOptional(isStr)(pair.wsname) || !isOptional(isStr)(pair.status)) {
          return fail("kraken list: unexpected shape");
        }
        const tick = own(tickRes, key);
        if (!tick) continue;
        if (!isObj(tick) || !Array.isArray(tick.c) || !tick.c.every(isNumeric) || !Array.isArray(tick.v) || !tick.v.every(isNumeric)) {
          return fail("kraken ticker: unexpected shape");
        }

        const [base, quote] = pair.wsname?.split("/") ?? [];
        if (!base || !quote || (pair.status !== undefined && pair.status !== "online")) continue;

        rows.push({
          pair: `${base}/${quote}`,
          base,
          quote,
          last: tick.c[0],
          bid: Array.isArray(tick.b) && isNumeric(tick.b[0]) ? tick.b[0] : undefined,
          ask: Array.isArray(tick.a) && isNumeric(tick.a[0]) ? tick.a[0] : undefined,
          baseVolume: tick.v[1],
        });
      }
      return ok(buildTickers("kraken", rows, only));
    },
  },
  {
    id: "coinbase",
    calls: [
      { name: "list", path: "/products" },
      { name: "ticker", path: "/products/stats" },
    ],
    parse(payloads, only) {
      const list = filterRows(payloads.list, {
        id: isStr,
        base_currency: isStr,
        quote_currency: isStr,
        status: isStr,
        trading_disabled: isOptional(isBool),
      });
      if (!list) return fail("coinbase list: unexpected shape");
      const stats = payloads.ticker;
      const validDay = (d) => d === undefined || (isRecord(d) && isOptional(isNumeric)(d.last) && isOptional(isNumeric)(d.volume));
      if (!isRecord(stats) || !Object.values(stats).every((e) => isRecord(e) && validDay(e.stats_24hour))) {
        return fail("coinbase ticker: unexpected shape");
      }

      const rows = [];
      for (const product of list) {
        const day = own(stats, product.id)?.stats_24hour;
        if (product.status !== "online" || product.trading_disabled === true || !day) continue;

        rows.push({
          pair: product.id,
          base: product.base_currency,
          quote: product.quote_currency,
          last: day.last,
          baseVolume: day.volume,
        });
      }
      return ok(buildTickers("coinbase", rows, only));
    },
  },
  {
    id: "cryptocom",
    calls: [
      { name: "list", path: "/exchange/v1/public/get-instruments" },
      { name: "ticker", path: "/exchange/v1/public/get-tickers" },
    ],
    parse(payloads, only) {
      const list = isObj(payloads.list?.result)
        ? filterRows(payloads.list.result.data, { symbol: isStr, inst_type: isStr, base_ccy: isStr, quote_ccy: isStr, tradable: isOptional(isBool) })
        : null;
      if (!list) return fail("cryptocom list: unexpected shape");

      const ticks = isObj(payloads.ticker?.result)
        ? filterRows(payloads.ticker.result.data, { i: isStr, a: isNumeric, b: isOptional(isNumeric), k: isOptional(isNumeric), vv: isOptional(isNumeric) })
        : null;
      if (!ticks) return fail("cryptocom ticker: unexpected shape");

      const spot = list.filter((r) => r.inst_type === "CCY_PAIR" && r.tradable !== false);
      const rows = joinByPair(spot, ticks, (r) => r.symbol, (t) => t.i).map(([r, t]) => ({
        pair: r.symbol,
        base: r.base_ccy,
        quote: r.quote_ccy,
        last: t.a,
        bid: t.b,
        ask: t.k,
        quoteVolume: t.vv,
      }));
      return ok(buildTickers("cryptocom", rows, only));
    },
  },
  {
    id: "bitfinex",
    calls: [{ name: "ticker", path: "/v2/tickers?symbols=ALL" }],
    parse(payloads, only) {
      const raw = payloads.ticker;
      if (!Array.isArray(raw) || !raw.every((r) => Array.isArray(r) && r.every((c) => isStr(c) || isNum(c) || c === null))) {
        return fail("bitfinex ticker: unexpected shape");
      }
      const rows = raw.flatMap((row) => {
        const symbol = row[0];
        const parts = isStr(symbol) ? splitBitfinexSymbol(symbol) : undefined;
        if (!parts) return [];
        return [{ pair: symbol, base: parts[0], quote: parts[1], bid: row[1], ask: row[3], last: row[7], baseVolume: row[8] }];
      });
      return ok(buildTickers("bitfinex", rows, only));
    },
  },
  {
    id: "bitstamp",
    calls: [{ name: "ticker", path: "/api/v2/ticker/" }],
    parse(payloads, only) {
      const ticks = filterRows(payloads.ticker, {
        pair: isStr,
        last: isNumeric,
        bid: isOptional(isNumeric),
        ask: isOptional(isNumeric),
        volume: isOptional(isNumeric),
      });
      if (!ticks) return fail("bitstamp ticker: unexpected shape");

      const rows = ticks.flatMap((r) => {
        const [base, quote] = r.pair.split("/");
        return base && quote ? [{ pair: r.pair, base, quote, last: r.last, bid: r.bid, ask: r.ask, baseVolume: r.volume }] : [];
      });
      return ok(buildTickers("bitstamp", rows, only));
    },
  },
  {
    id: "hyperliquid",
    calls: [{ name: "ticker", path: "/info", method: "POST", body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }) }],
    parse(payloads, only) {
      const payload = payloads.ticker;
      if (!Array.isArray(payload) || payload.length < 2 || !isObj(payload[0]) || !Array.isArray(payload[1])) {
        return fail("hyperliquid ticker: unexpected shape");
      }
      const [meta, contexts] = payload;
      if (!Array.isArray(meta.tokens) || !Array.isArray(meta.universe)) {
        return fail("hyperliquid ticker: unexpected shape");
      }

      const tokenNames = new Map();
      for (const t of meta.tokens) {
        if (!isObj(t) || !isStr(t.name) || !isNum(t.index)) return fail("hyperliquid ticker: unexpected shape");
        tokenNames.set(t.index, t.name);
      }

      const contextMap = new Map();
      for (const c of contexts) {
        if (!isObj(c) || !isStr(c.coin) || !isOptional(isNumeric)(c.markPx) || !isOptional(isNullable(isNumeric))(c.midPx) || !isOptional(isNumeric)(c.dayNtlVlm)) {
          return fail("hyperliquid ticker: unexpected shape");
        }
        contextMap.set(c.coin, c);
      }

      const rows = [];
      for (const market of meta.universe) {
        if (!isObj(market) || !isStr(market.name) || !Array.isArray(market.tokens) || market.tokens.length < 2 || !isNum(market.tokens[0]) || !isNum(market.tokens[1]) || !isNum(market.index)) {
          return fail("hyperliquid ticker: unexpected shape");
        }
        const base = tokenNames.get(market.tokens[0]);
        const quote = tokenNames.get(market.tokens[1]);
        const ctx = contextMap.get(market.name);
        if (base && quote && ctx) {
          rows.push({ pair: market.name, base, quote, last: ctx.midPx ?? ctx.markPx, quoteVolume: ctx.dayNtlVlm });
        }
      }
      return ok(buildTickers("hyperliquid", rows, only));
    },
  },
  {
    id: "mexc",
    calls: [
      { name: "list", path: "/api/v3/exchangeInfo" },
      { name: "ticker", path: "/api/v3/ticker/24hr" },
    ],
    parse(payloads, only) {
      const list = isObj(payloads.list)
        ? filterRows(payloads.list.symbols, {
            symbol: isStr,
            baseAsset: isStr,
            quoteAsset: isStr,
            status: (v) => isStr(v) || isNum(v),
            isSpotTradingAllowed: isOptional(isBool),
          })
        : null;
      if (!list) return fail("mexc list: unexpected shape");

      const ticks = filterRows(payloads.ticker, {
        symbol: isStr,
        lastPrice: isNumeric,
        bidPrice: isNullish(isNumeric),
        askPrice: isNullish(isNumeric),
        quoteVolume: isNullish(isNumeric),
      });
      if (!ticks) return fail("mexc ticker: unexpected shape");

      const trading = list.filter((s) => MEXC_ONLINE_STATUS.has(String(s.status).toUpperCase()) && s.isSpotTradingAllowed !== false);
      const rows = joinByPair(trading, ticks, (r) => r.symbol, (t) => t.symbol).map(([r, t]) => ({
        pair: r.symbol,
        base: r.baseAsset,
        quote: r.quoteAsset,
        last: t.lastPrice,
        bid: t.bidPrice ?? undefined,
        ask: t.askPrice ?? undefined,
        quoteVolume: t.quoteVolume ?? undefined,
      }));
      return ok(buildTickers("mexc", rows, only));
    },
  },
];

const ADAPTER_MAP = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

// --- Collector & Exports ---

export const HOSTS = Object.fromEntries(VENUES_CONFIG.venues.map((v) => [v.id, v.host]));

export const VENUES = THRESHOLDS_CONFIG.primary.github_venues
  .split(",")
  .map((v) => v.trim())
  .filter((v) => v !== "binance");

export async function collect(ids, hosts, get, now = () => new Date()) {
  const result = { venues: {}, failed: [] };

  await Promise.all(
    ids.map(async (id) => {
      const adapter = ADAPTER_MAP.get(id);
      const host = Object.hasOwn(hosts, id) ? hosts[id] : undefined;

      if (!adapter || !host) {
        result.failed.push(id);
        return;
      }

      try {
        const payloads = {};
        for (const call of adapter.calls) {
          const init = {};
          if (call.method) init.method = call.method;
          if (call.body) init.body = call.body;
          payloads[call.name] = await get(`${host}${call.path}`, init);
        }

        const parsed = adapter.parse(payloads);
        if (!parsed.ok) throw new Error(parsed.error);

        result.venues[id] = {
          fetched_at: now().toISOString(),
          tickers: parsed.value.map((t) => [t.pair, t.base, t.quote, t.last.toString(), t.volumeUsd.toString()]),
        };
      } catch {
        result.failed.push(id);
      }
    }),
  );

  result.failed.sort();
  return result;
}
