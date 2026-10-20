# Better Ball API + MCP server + Foundry agents.
# Build from the repo root:  docker build -f service/Dockerfile -t betterball-api .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    BETTERBALL_DATA=/app/data/match_7.json \
    BETTERBALL_MCP_URL=http://127.0.0.1:8000/mcp/

WORKDIR /app
COPY service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY service/betterball_service ./betterball_service
COPY web/public/data/match_7.json ./data/match_7.json

RUN useradd --create-home app && chown -R app /app
USER app

EXPOSE 8000
CMD ["uvicorn", "betterball_service.api:app", "--host", "0.0.0.0", "--port", "8000"]
