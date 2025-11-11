use anyhow::{Error, Result, anyhow};
use redis::{AsyncCommands, Client, aio::MultiplexedConnection};
use tracing::{debug, info, warn};

use crate::{
    config::Config,
    models::{retry::RetryConfig, status::IdempotencyStatus},
    utils::retry_with_backoff,
};

pub struct RedisClient {
    connection: MultiplexedConnection,
    idempotency_ttl_seconds: u64,
    retry_config: RetryConfig,
}

impl RedisClient {
    pub async fn connect(config: &Config) -> Result<Self, Error> {
        info!("Connecting to Redis");

        let client = Client::open(config.redis_url.as_str())
            .map_err(|_| anyhow!("Failed to create redis client"))?;

        let connection = client
            .get_multiplexed_async_connection()
            .await
            .map_err(|_| anyhow!("Failed to connect to redis client"))?;

        info!("Redis connection established");

        Ok(Self {
            connection,
            idempotency_ttl_seconds: config.idempotency_ttl_seconds,
            retry_config: config.retry_config(),
        })
    }

    pub async fn check_idempotency(
        &mut self,
        idempotency_key: &str,
    ) -> Result<IdempotencyStatus, Error> {
        let key = format!("idempotency:{}", idempotency_key);

        let value: Option<String> = self
            .connection
            .get(&key)
            .await
            .map_err(|_| anyhow!("Failed to get cached value"))?;

        let status = match value.as_deref() {
            None => IdempotencyStatus::NotFound,
            Some("processing") => IdempotencyStatus::Processing,
            Some("sent") => IdempotencyStatus::Sent,
            Some("failed") => IdempotencyStatus::Failed,
            Some(other) => {
                warn!(
                    key = %key,
                    unknown_status = %other,
                    "Unknown idempotency status, treating as NotFound"
                );
                IdempotencyStatus::NotFound
            }
        };

        debug!(idempotency_key, status = ?status, "Checked idempotency");

        Ok(status)
    }

    pub async fn mark_as_processing(&mut self, idempotency_key: &str) -> Result<(), Error> {
        let key = format!("idempotency:{}", idempotency_key);

        self.connection
            .set_ex::<_, _, ()>(&key, "processing", self.idempotency_ttl_seconds)
            .await
            .map_err(|e| anyhow!("Failed to mark value as processing: {}", e))?;

        debug!(idempotency_key, "Marked as processing");

        Ok(())
    }

    pub async fn mark_as_sent(&mut self, idempotency_key: &str) -> Result<(), Error> {
        let key = format!("idempotency:{}", idempotency_key);

        retry_with_backoff(&self.retry_config, || {
            let key_clone = key.clone();
            let mut conn = self.connection.clone();
            let ttl = self.idempotency_ttl_seconds;

            async move {
                conn.set_ex::<_, _, ()>(&key_clone, "sent", ttl)
                    .await
                    .map_err(|e| e.to_string())
            }
        })
        .await
        .map_err(|e| anyhow!("mark_as_sent failed: {}", e))?;

        debug!(idempotency_key, "Marked as sent");

        Ok(())
    }

    pub async fn mark_as_failed(&mut self, idempotency_key: &str) -> Result<(), Error> {
        let key = format!("idempotency:{}", idempotency_key);

        self.connection
            .set_ex::<_, _, ()>(&key, "failed", self.idempotency_ttl_seconds)
            .await
            .map_err(|_| anyhow!("Failed to mark value as failed"))?;

        debug!(idempotency_key, "Marked as failed");

        Ok(())
    }
}
