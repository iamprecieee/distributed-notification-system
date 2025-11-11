use anyhow::{Error, Result, anyhow};
use redis::{AsyncCommands, aio::MultiplexedConnection};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{debug, info, warn};

use crate::models::circuit_breaker::{CircuitBreakerConfig, CircuitState};

pub struct CircuitBreaker {
    service_name: String,
    connection: MultiplexedConnection,
    config: CircuitBreakerConfig,
}

impl CircuitBreaker {
    pub fn new(
        service_name: String,
        connection: MultiplexedConnection,
        config: CircuitBreakerConfig,
    ) -> Self {
        info!(service = %service_name, "Circuit breaker initialized");

        Self {
            service_name,
            connection,
            config,
        }
    }

    pub async fn call<F, Fut, T>(&mut self, operation: F) -> Result<T, Error>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, Error>>,
    {
        let state = self.get_state().await?;

        match state {
            CircuitState::Open => {
                if self.should_attempt_reset().await? {
                    info!(service = %self.service_name, "Circuit breaker attempting reset");
                    self.set_state(CircuitState::HalfOpen).await?;
                    return self.try_operation(operation).await;
                }
                warn!(service = %self.service_name, "Circuit breaker is open, rejecting request");
                Err(anyhow!("Circuit breaker is open for {}", self.service_name))
            }
            CircuitState::HalfOpen => {
                debug!(service = %self.service_name, "Circuit breaker in half-open state");
                self.try_operation(operation).await
            }
            CircuitState::Closed => {
                self.try_operation(operation).await
            }
        }
    }

    async fn try_operation<F, Fut, T>(&mut self, operation: F) -> Result<T, Error>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, Error>>,
    {
        match operation().await {
            Ok(result) => {
                self.record_success().await?;
                Ok(result)
            }
            Err(e) => {
                self.record_failure().await?;
                Err(e)
            }
        }
    }

    async fn record_success(&mut self) -> Result<(), Error> {
        let state = self.get_state().await?;

        if state == CircuitState::HalfOpen {
            let successes = self.increment_success_count().await?;
            debug!(
                service = %self.service_name,
                successes,
                threshold = self.config.success_threshold,
                "Circuit breaker success recorded"
            );

            if successes >= self.config.success_threshold {
                self.set_state(CircuitState::Closed).await?;
                self.reset_counters().await?;
                info!(service = %self.service_name, "Circuit breaker closed after successful recovery");
            }
        } else if state == CircuitState::Closed {
            self.reset_failure_count().await?;
        }

        Ok(())
    }

    async fn record_failure(&mut self) -> Result<(), Error> {
        let state = self.get_state().await?;

        if state == CircuitState::HalfOpen {
            self.set_state(CircuitState::Open).await?;
            self.set_opened_at().await?;
            warn!(service = %self.service_name, "Circuit breaker reopened after failed recovery attempt");
            return Ok(());
        }

        let failures = self.increment_failure_count().await?;
        debug!(
            service = %self.service_name,
            failures,
            threshold = self.config.failure_threshold,
            "Circuit breaker failure recorded"
        );

        if failures >= self.config.failure_threshold {
            self.set_state(CircuitState::Open).await?;
            self.set_opened_at().await?;
            warn!(
                service = %self.service_name,
                failures,
                "Circuit breaker opened due to consecutive failures"
            );
        }

        Ok(())
    }

    async fn get_state(&mut self) -> Result<CircuitState, Error> {
        let key = format!("circuit:{}:state", self.service_name);
        let value: Option<String> = self.connection.get(&key).await?;

        Ok(value
            .map(|s| CircuitState::from_string(&s))
            .unwrap_or(CircuitState::Closed))
    }

    async fn set_state(&mut self, state: CircuitState) -> Result<(), Error> {
        let key = format!("circuit:{}:state", self.service_name);
        self.connection
            .set::<_, _, ()>(&key, state.as_str())
            .await?;
        Ok(())
    }

    async fn increment_failure_count(&mut self) -> Result<u32, Error> {
        let key = format!("circuit:{}:failures", self.service_name);
        let count: u32 = self.connection.incr(&key, 1).await?;
        self.connection
            .expire::<_, ()>(&key, self.config.timeout_seconds as i64)
            .await?;
        Ok(count)
    }

    async fn reset_failure_count(&mut self) -> Result<(), Error> {
        let key = format!("circuit:{}:failures", self.service_name);
        self.connection.del::<_, ()>(&key).await?;
        Ok(())
    }

    async fn increment_success_count(&mut self) -> Result<u32, Error> {
        let key = format!("circuit:{}:successes", self.service_name);
        let count: u32 = self.connection.incr(&key, 1).await?;
        Ok(count)
    }

    async fn reset_counters(&mut self) -> Result<(), Error> {
        let failure_key = format!("circuit:{}:failures", self.service_name);
        let success_key = format!("circuit:{}:successes", self.service_name);
        let opened_key = format!("circuit:{}:opened_at", self.service_name);

        self.connection.del::<_, ()>(&failure_key).await?;
        self.connection.del::<_, ()>(&success_key).await?;
        self.connection.del::<_, ()>(&opened_key).await?;

        Ok(())
    }

    async fn set_opened_at(&mut self) -> Result<(), Error> {
        let key = format!("circuit:{}:opened_at", self.service_name);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        self.connection.set::<_, _, ()>(&key, now).await?;
        Ok(())
    }

    async fn should_attempt_reset(&mut self) -> Result<bool, Error> {
        let key = format!("circuit:{}:opened_at", self.service_name);
        let opened_at: Option<u64> = self.connection.get(&key).await?;

        if let Some(opened_at) = opened_at {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs();
            let elapsed = now - opened_at;
            return Ok(elapsed >= self.config.timeout_seconds);
        }

        Ok(false)
    }
}