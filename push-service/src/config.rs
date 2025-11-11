use anyhow::{Error, Result, anyhow};
use dotenvy::dotenv;
use serde::Deserialize;

#[derive(Clone, Deserialize, Debug)]
pub struct Config {
    pub rabbitmq_url: String,
    pub push_queue_name: String,
    pub failed_queue_name: String,
    pub prefetch_count: u16,

    pub redis_url: String,
    pub idempotency_ttl_seconds: u64,

    pub database_url: String,

    pub template_service_url: String,

    pub fcm_server_key: String,
    pub fcm_url: String,

    pub circuit_breaker_failure_threshold: u32,
    pub circuit_breaker_timeout_seconds: u64,
    pub circuit_breaker_success_threshold: u32,

    pub max_retry_attempts: u32,
    pub initial_retry_delay_ms: u64,
    pub max_retry_delay_ms: u64,
    pub retry_backoff_multiplier: u64,

    pub worker_concurrency: usize,

    pub server_port: u16,
}

impl Config {
    pub fn load() -> Result<Self, Error> {
        dotenv().ok();

        let config = envy::from_env::<Self>()
            .map_err(|_| anyhow!("Invalid or missing environmental variable"))?;
        Ok(config)
    }
}
