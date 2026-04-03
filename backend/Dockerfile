# ── Stage 1: Builder ──
FROM python:3.12-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: Runtime ──
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 curl && \
    rm -rf /var/lib/apt/lists/* && \
    addgroup --system app && adduser --system --ingroup app app

COPY --from=builder /install /usr/local

COPY . .

ENV DJANGO_SETTINGS_MODULE=config.settings_prod

RUN chmod +x entrypoint.sh && \
    mkdir -p /app/media /app/staticfiles && \
    chown -R app:app /app

USER app

EXPOSE 8000 7005

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8000/iclock/cdata?SN=healthcheck || exit 1

CMD ["./entrypoint.sh"]
