"""MCP server exposing the decision engine's match knowledge as tools.

Mounted by the API at /mcp (streamable HTTP). Any MCP client can use it: our
Foundry agents, VS Code / GitHub Copilot agent mode, or the MCP Inspector.

    python -m betterball_service.mcp_server      # standalone on :8765
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from . import store

# DNS-rebinding protection stays on: localhost plus any public host names we are served under
# (e.g. the Container App's FQDN), so remote MCP clients such as VS Code can connect too.
_hosts = ["127.0.0.1:*", "localhost:*", "[::1]:*"] + [
    h.strip() for h in os.environ.get("MCP_ALLOWED_HOSTS", "").split(",") if h.strip()
]

mcp = FastMCP(
    "betterball",
    instructions=(
        "Tools over a synthetic football match analysed by The Better Ball. Every pass and shot "
        "was scored against all the options the player had. Use these tools for facts; never invent numbers."
    ),
    streamable_http_path="/",
    stateless_http=True,
    json_response=True,
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=_hosts,
        allowed_origins=[f"https://{h}" for h in _hosts if "*" not in h]
        + ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"],
    ),
)

for fn in store.TOOLS:
    mcp.tool()(fn)


if __name__ == "__main__":
    mcp.settings.port = 8765
    mcp.run(transport="streamable-http")
