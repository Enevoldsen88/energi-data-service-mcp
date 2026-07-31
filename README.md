# Energi Data Service MCP

Read-only remote MCP server for Energinet's public
[Energi Data Service](https://www.energidataservice.dk/).

## Tools

- `search_datasets` — search dataset metadata.
- `get_dataset` — query any named dataset with dates, columns and filters.
- `get_co2_emissions` — retrieve 5-minute CO2 intensity for DK1 or DK2.

No Energinet API key is required.

## Run locally

```bash
npm install
npm start
```

The MCP endpoint is `http://localhost:3000/mcp`.

## Deploy

ChatGPT requires a remote HTTPS MCP endpoint. Deploy this repository on a
Node-compatible host such as Render, Railway, Fly.io or Google Cloud Run.
`render.yaml` and `Dockerfile` are included.

After deployment, the endpoint is:

```text
https://YOUR-HOST/mcp
```

## Connect in ChatGPT

1. Enable Developer mode in ChatGPT under **Settings → Apps → Advanced
   settings**. Workspace permissions may require an admin/owner.
2. Choose **Settings → Apps → Create**.
3. Enter the deployed HTTPS endpoint ending in `/mcp`.
4. Choose **No authentication**.
5. Select **Scan tools**, review the three read-only tools, and create the app.
6. Start a new conversation and enable the app from the tools menu.

## Example requests

- "Find Energinet datasets about electricity prices."
- "Get CO2 intensity for DK1 for the past 24 hours."
- "Get records from DeclarationProduction for DK1 in January 2026."

## Operational notes

- The upstream API applies dataset-specific rate limits. Avoid polling faster
  than the source dataset's update frequency.
- Generic queries are capped at 5,000 records per call.
- The server does not store user data or upstream responses.
