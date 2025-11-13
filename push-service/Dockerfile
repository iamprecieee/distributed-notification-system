FROM rust:1.90-slim-bookworm AS builder

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Cargo.toml ./

COPY src ./src
COPY tests ./tests

RUN cargo build --release --bin push_service

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    curl \
    netcat-traditional \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 appuser

WORKDIR /app

COPY --from=builder /app/target/release/push_service /app/push_service

COPY schema.sql /app/schema.sql

COPY service-account.json /app/service-account.json

RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'echo "Waiting for RabbitMQ to be ready..."' >> /app/entrypoint.sh && \
    echo 'while ! nc -z rabbitmq 5672; do' >> /app/entrypoint.sh && \
    echo '  echo "RabbitMQ not ready, waiting..."' >> /app/entrypoint.sh && \
    echo '  sleep 2' >> /app/entrypoint.sh && \
    echo 'done' >> /app/entrypoint.sh && \
    echo 'echo "RabbitMQ is ready, starting push service..."' >> /app/entrypoint.sh && \
    echo 'sleep 3' >> /app/entrypoint.sh && \
    echo 'exec /app/push_service' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

RUN chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["/app/entrypoint.sh"]