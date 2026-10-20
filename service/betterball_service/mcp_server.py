"""MCP server exposing the decision engine's match knowledge as tools.

Mounted by the API at /mcp (streamable HTTP). Any MCP client can use it: our
Foundry agents, VS Code / GitHub Copilot agent mode, or the MCP Inspector.

    python -m betterball_service.mcp_server      # standalone on :8765
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from . import store

mcp = FastMCP(
    "betterball",
    instructions=(
        "Tools over a synthetic football match analysed by The Better Ball. Every pass and shot "
        "was scored against all the options the player had. Use these tools for facts; never invent numbers."
    ),
    streamable_http_path="/",
    stateless_http=True,
    json_response=True,
)

for fn in store.TOOLS:
    mcp.tool()(fn)


if __name__ == "__main__":
    mcp.settings.port = 8765
    mcp.run(transport="streamable-http")
