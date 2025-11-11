use anyhow::{Error, Result, anyhow};
use redis::{AsyncCommands, Client, aio::MultiplexedConnection};

use crate::{config::Config, models::status::IdempotencyStatus};

pub struct RedisClient {
    connection: MultiplexedConnection,
    idempotency_ttl_seconds: u64,
}

impl RedisClient {
    pub async fn connect(config: &Config) -> Result<Self, Error> {
        println!("Connecting to Redis...");

        let client = Client::open(config.redis_url.as_str())
            .map_err(|_| anyhow!("Failed to create redis client"))?;

        let connection = client
            .get_multiplexed_async_connection()
            .await
            .map_err(|_| anyhow!("Failed to connect to redis client"))?;

        println!("Redis connection established");

        Ok(Self {
            connection,
            idempotency_ttl_seconds: config.idempotency_ttl_seconds,
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

        match value.as_deref() {
            None => Ok(IdempotencyStatus::NotFound),
            Some("processing") => Ok(IdempotencyStatus::Processing),
            Some("sent") => Ok(IdempotencyStatus::Sent),
            Some("failed") => Ok(IdempotencyStatus::Failed),
            Some(other) => {
                eprintln!(
                    "Warning: Unknown idempotency status '{}' for key '{}'",
                    other, key
                );
                Ok(IdempotencyStatus::NotFound)
            }
        }
    }

    pub async fn mark_as_processing(&mut self, idempotency_key: &str) -> Result<(), Error> {
        let key = format!("idempotency:{}", idempotency_key);

        self.connection
            .set_ex::<_, _, ()>(&key, "processing", self.idempotency_ttl_seconds)
            .await
            .map_err(|e| anyhow!("Failed to mark value as processing: {}", e))?;

        Ok(())
    }

    pub async fn mark_as_sent(&mut self, idempotency_key: &str) -> Result<(), Error> {
        let key = format!("idempotency:{}", idempotency_key);

        self.connection
            .set_ex::<_, _, ()>(&key, "sent", self.idempotency_ttl_seconds)
            .await
            .map_err(|_| anyhow!("Failed to mark value as sent"))?;

        Ok(())
    }

    pub async fn mark_as_failed(&mut self, idempotency_key: &str) -> Result<(), Error> {
        let key = format!("idempotency:{}", idempotency_key);

        self.connection
            .set_ex::<_, _, ()>(&key, "failed", self.idempotency_ttl_seconds)
            .await
            .map_err(|_| anyhow!("Failed to mark value as failed"))?;

        Ok(())
    }
}
