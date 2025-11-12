use anyhow::{Error, Result, anyhow};
use dotenvy::dotenv;
use serde::Deserialize;

use crate::models::{circuit_breaker::CircuitBreakerConfig, retry::RetryConfig};

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

    pub fcm_project_id: String,

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

    pub fn retry_config(&self) -> RetryConfig {
        RetryConfig {
            max_attempts: self.max_retry_attempts,
            initial_delay_ms: self.initial_retry_delay_ms,
            max_delay_ms: self.max_retry_delay_ms,
            backoff_multiplier: self.retry_backoff_multiplier,
        }
    }

    pub fn circuit_breaker_config(&self) -> CircuitBreakerConfig {
        CircuitBreakerConfig {
            failure_threshold: self.circuit_breaker_failure_threshold,
            timeout_seconds: self.circuit_breaker_timeout_seconds,
            success_threshold: self.circuit_breaker_success_threshold,
        }
    }
}
