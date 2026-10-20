"""Application Insights telemetry and a small per-visitor rate limit for the public API."""

from __future__ import annotations

import logging
import os
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

log = logging.getLogger("betterball")


def setup_telemetry() -> bool:
    """Send traces, metrics and logs to Azure Monitor when a connection string is configured.

    Agent Framework spans (agent runs, tool calls, token usage) are included; prompt and response
    content is not (sensitive data stays off).
    """
    conn = os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING")
    if not conn:
        return False
    from agent_framework.observability import enable_instrumentation
    from azure.monitor.opentelemetry import configure_azure_monitor

    configure_azure_monitor(connection_string=conn, logger_name="betterball")
    enable_instrumentation(enable_sensitive_data=False)
    log.info("Azure Monitor telemetry enabled")
    return True


class RateLimiter:
    """Sliding-window limit per client IP, plus a global ceiling, for the model-backed endpoints."""

    def __init__(self, per_ip: int, global_limit: int, window: float = 60.0):
        self.per_ip, self.global_limit, self.window = per_ip, global_limit, window
        self.hits: dict[str, deque] = defaultdict(deque)
        self.all: deque = deque()

    @staticmethod
    def client_ip(request: Request) -> str:
        # Azure Container Apps puts the caller first in X-Forwarded-For.
        fwd = request.headers.get("x-forwarded-for", "")
        return fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")

    def _trim(self, q: deque, now: float) -> None:
        while q and now - q[0] > self.window:
            q.popleft()

    def check(self, request: Request) -> None:
        now = time.monotonic()
        ip = self.client_ip(request)
        q = self.hits[ip]
        self._trim(q, now)
        self._trim(self.all, now)
        if len(q) >= self.per_ip or len(self.all) >= self.global_limit:
            raise HTTPException(429, "Too many AI requests. Please wait a minute and try again.")
        q.append(now)
        self.all.append(now)


limiter = RateLimiter(
    per_ip=int(os.environ.get("AI_RATE_PER_IP", "12")),
    global_limit=int(os.environ.get("AI_RATE_GLOBAL", "120")),
)
