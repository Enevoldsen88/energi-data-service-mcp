import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = "https://api.energidataservice.dk";
const MAX_LIMIT = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;

function jsonText(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function errorResult(message, details) {
  const payload = details ? { error: message, details } : { error: message };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

async function energiGet(pathname, params = {}) {
  const url = new URL(pathname, BASE_URL);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "energi-data-service-mcp/1.0",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 1_000);
    throw new Error(`Energi Data Service returned HTTP ${response.status}: ${body}`);
  }

  return response.json();
}

function createServer() {
  const server = new McpServer({
    name: "Energi Data Service",
    version: "1.0.0",
  });

  server.registerTool(
    "search_datasets",
    {
      title: "Search Energi Data Service datasets",
      description:
        "Search Energinet's public dataset catalogue by words such as CO2, electricity, production, consumption or prices. Read-only.",
      inputSchema: {
        query: z.string().min(1).describe("Words to match against dataset metadata"),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ query, limit }) => {
      try {
        const data = await energiGet("/meta/dataset");
        const candidates = Array.isArray(data) ? data : data.records || data.datasets || [];
        const needle = query.toLocaleLowerCase("en");

        const results = candidates
          .filter((item) => JSON.stringify(item).toLocaleLowerCase("en").includes(needle))
          .slice(0, limit)
          .map((item) => ({
            id: item.datasetId || item.name || item.id || item.title,
            title: item.title || item.name || item.datasetId || "Dataset",
            description: item.description || item.abstract || "",
            metadata: item,
          }));

        return jsonText({ query, results });
      } catch (error) {
        return errorResult("Dataset search failed", error.message);
      }
    },
  );

  server.registerTool(
    "get_dataset",
    {
      title: "Get Energi Data Service records",
      description:
        "Fetch records from a named Energi Data Service dataset. Supports date range, selected columns, exact-match filters, sorting and a bounded record limit. Read-only.",
      inputSchema: {
        dataset: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
        start: z
          .string()
          .optional()
          .describe("Start in Danish local time, e.g. 2025-01-01 or now-P1D"),
        end: z
          .string()
          .optional()
          .describe("Exclusive end in Danish local time, e.g. 2026-01-01 or now"),
        columns: z.array(z.string()).max(100).optional(),
        filters: z
          .record(z.array(z.union([z.string(), z.number(), z.boolean()])))
          .optional()
          .describe('Exact-match filters, e.g. {"PriceArea":["DK1"]}'),
        sort: z.string().max(300).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(100),
      },
    },
    async ({ dataset, start, end, columns, filters, sort, offset, limit }) => {
      try {
        const data = await energiGet(`/dataset/${encodeURIComponent(dataset)}`, {
          start,
          end,
          columns: columns?.join(","),
          filter: filters ? JSON.stringify(filters) : undefined,
          sort,
          offset,
          limit,
        });
        return jsonText(data);
      } catch (error) {
        return errorResult(`Could not fetch dataset ${dataset}`, error.message);
      }
    },
  );

  server.registerTool(
    "get_co2_emissions",
    {
      title: "Get Danish electricity CO2 emissions",
      description:
        "Fetch Energinet's 5-minute CO2 emission intensity for Danish electricity price area DK1 or DK2. Values are reported by the source in grams CO2 per kWh. Read-only.",
      inputSchema: {
        price_area: z.enum(["DK1", "DK2"]),
        start: z.string().default("now-PT1H"),
        end: z.string().default("now"),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(1_000),
      },
    },
    async ({ price_area, start, end, limit }) => {
      try {
        const data = await energiGet("/dataset/CO2Emis", {
          start,
          end,
          columns: "Minutes5UTC,Minutes5DK,PriceArea,CO2Emission",
          filter: JSON.stringify({ PriceArea: [price_area] }),
          sort: "Minutes5DK",
          limit,
        });
        return jsonText(data);
      } catch (error) {
        return errorResult("Could not fetch CO2 emission data", error.message);
      }
    },
  );

  return server;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "Energi Data Service MCP",
    status: "ok",
    mcp_endpoint: "/mcp",
    source: "https://www.energidataservice.dk",
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(`[${randomUUID()}] MCP request failed`, error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: req.body?.id ?? null,
      });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").send("Use POST for stateless MCP requests.");
});

app.delete("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").send("Stateless MCP sessions do not require DELETE.");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Energi Data Service MCP listening on port ${PORT}`);
});
