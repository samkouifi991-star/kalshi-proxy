const http = require("http");

const PORT = process.env.PORT || 3001;
const KALSHI_API_KEY = process.env.KALSHI_API_KEY;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const KALSHI_API_BASE = "https://api.elections.kalshi.com/trade-api/v2";

const TENNIS_KEYWORDS = [
  "tennis", "atp", "wta", "grand slam", "roland garros",
  "wimbledon", "us open", "australian open",
];

function isTennisMarket(market) {
  const title = (market.title || "").toLowerCase();

  // tennis tournaments / keywords
  const tennisHints =
    title.includes("atp") ||
    title.includes("wta") ||
    title.includes("tennis") ||
    title.includes("wimbledon") ||
    title.includes("us open") ||
    title.includes("australian open") ||
    title.includes("roland garros");

  const hasPlayers =
    title.includes(" vs ") || title.includes(" v ");

  return tennisHints || hasPlayers;
}

function extractPlayers(title) {
  const match = title.match(/(.+?)\s+vs\.?\s+(.+?)(?:\s*[-–—]|\s*$)/i);
  if (match) return { player1: match[1].trim(), player2: match[2].trim() };
  return { player1: "Player 1", player2: "Player 2" };
}

function corsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(res, status, data) {
  corsHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function fetchKalshiMarkets() {
  const allMarkets = [];
  let cursor = null;
  let pages = 0;

  while (pages < 5) {
    const params = new URLSearchParams({ limit: "200", status: "open" });
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(`${KALSHI_API_BASE}/markets?${params}`, {
      headers: {
        Authorization: `Bearer ${KALSHI_API_KEY}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kalshi API ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const markets = data.markets || [];
    allMarkets.push(...markets);

    cursor = data.cursor || null;
    if (!cursor || markets.length === 0) break;
    pages++;
  }

  return allMarkets;
}

function structureMarket(m) {
  const { player1, player2 } = extractPlayers(m.title || "");
  const yesBid = m.yes_bid ?? 0;
  const yesAsk = m.yes_ask ?? 0;

  return {
    ticker: m.ticker,
    title: m.title || "",
    player1,
    player2,
    yesBid,
    yesAsk,
    noBid: m.no_bid ?? 100 - yesAsk,
    noAsk: m.no_ask ?? 100 - yesBid,
    lastPrice: m.last_price ?? m.yes_bid ?? 50,
    volume: m.volume ?? 0,
    liquidity: m.liquidity ?? 0,
    openTime: m.open_time || new Date().toISOString(),
    closeTime: m.close_time || new Date().toISOString(),
    spread: Math.abs(yesAsk - yesBid),
    status: m.status === "open" ? "active" : m.status,
    timestamp: Date.now(),
  };
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    corsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === "/" || req.url === "/health") {
    return sendJson(res, 200, { status: "ok", service: "kalshi-tennis-proxy" });
  }

  // Main endpoint
  if (req.url === "/api/tennis-markets" && req.method === "GET") {
    if (!KALSHI_API_KEY) {
      return sendJson(res, 500, { error: "KALSHI_API_KEY not configured" });
    }

    try {
      const allMarkets = await fetchKalshiMarkets();
      const tennisMarkets = allMarkets;
      const structured = tennisMarkets.map(structureMarket);

      console.log(`[${new Date().toISOString()}] Served ${structured.length} tennis markets (scanned ${allMarkets.length})`);

      return sendJson(res, 200, {
        markets: structured,
        count: structured.length,
        totalScanned: allMarkets.length,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error:`, err.message);
      return sendJson(res, 502, { error: err.message });
    }
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Kalshi Tennis Proxy running on port ${PORT}`);
  console.log(`Endpoint: GET /api/tennis-markets`);
  console.log(`API Key configured: ${KALSHI_API_KEY ? "Yes" : "No"}`);
});
