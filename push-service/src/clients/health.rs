use std::{collections::HashMap, time::Instant};

use anyhow::Result;
use chrono::Utc;
use redis::AsyncCommands;
use tracing::{debug, warn};

use crate::{
    clients::{database::DatabaseClient, rbmq::RabbitMqClient},
    config::Config,
    models::{
        circuit_breaker::CircuitState,
        health::{HealthCheckResponse, HealthStatus, ServiceHealth},
    },
};

pub struct HealthChecker {
    config: Config,
}

impl HealthChecker {
    pub fn new(config: Config) -> Self {
        Self { config }
    }

    pub async fn check_all(&self) -> HealthCheckResponse {
        let mut checks = HashMap::new();

        let db_health = self.check_database().await;
        checks.insert("database".to_string(), db_health);

        let redis_health = self.check_redis().await;
        checks.insert("cache_service".to_string(), redis_health);

        let rabbitmq_health = self.check_rabbitmq().await;
        checks.insert("message_broker".to_string(), rabbitmq_health);

        let fcm_health = self.check_circuit_breaker("fcm").await;
        checks.insert("fcm".to_string(), fcm_health);

        let template_health = self.check_circuit_breaker("template_service").await;
        checks.insert("template_service".to_string(), template_health);

        let overall_status = self.determine_overall_status(&checks);

        HealthCheckResponse {
            status: overall_status,
            timestamp: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            checks,
        }
    }

    async fn check_database(&self) -> ServiceHealth {
        let start = Instant::now();

        match DatabaseClient::connect(&self.config.database_url).await {
            Ok(client) => match client.health_check().await {
                Ok(_) => {
                    let elapsed = start.elapsed().as_millis() as u64;
                    debug!(response_time_ms = elapsed, "Database health check passed");
                    ServiceHealth::healthy(elapsed)
                }
                Err(e) => {
                    warn!(error = %e, "Database health check failed");
                    ServiceHealth::unhealthy(format!("Health check query failed: {}", e))
                }
            },
            Err(e) => {
                warn!(error = %e, "Database connection failed");
                ServiceHealth::unhealthy(format!("Connection failed: {}", e))
            }
        }
    }

    async fn check_redis(&self) -> ServiceHealth {
        let start = Instant::now();

        match redis::Client::open(self.config.redis_url.as_str()) {
            Ok(client) => match client.get_multiplexed_async_connection().await {
                Ok(mut conn) => match conn.ping::<String>().await {
                    Ok(_) => {
                        let elapsed = start.elapsed().as_millis() as u64;
                        debug!(response_time_ms = elapsed, "Redis health check passed");
                        ServiceHealth::healthy(elapsed)
                    }
                    Err(e) => {
                        warn!(error = %e, "Redis ping failed");
                        ServiceHealth::unhealthy(format!("Ping failed: {}", e))
                    }
                },
                Err(e) => {
                    warn!(error = %e, "Redis connection failed");
                    ServiceHealth::unhealthy(format!("Connection failed: {}", e))
                }
            },
            Err(e) => {
                warn!(error = %e, "Redis client creation failed");
                ServiceHealth::unhealthy(format!("Client creation failed: {}", e))
            }
        }
    }

    async fn check_rabbitmq(&self) -> ServiceHealth {
        let start = Instant::now();

        match RabbitMqClient::connect(&self.config).await {
            Ok(_) => {
                let elapsed = start.elapsed().as_millis() as u64;
                debug!(response_time_ms = elapsed, "RabbitMQ health check passed");
                ServiceHealth::healthy(elapsed)
            }
            Err(e) => {
                warn!(error = %e, "RabbitMQ connection failed");
                ServiceHealth::unhealthy(format!("Connection failed: {}", e))
            }
        }
    }

    async fn check_circuit_breaker(&self, service_name: &str) -> ServiceHealth {
        match self.get_circuit_breaker_state(service_name).await {
            Ok(state) => {
                let state_str = state.as_str().to_string();
                debug!(
                    service = service_name,
                    circuit_state = %state_str,
                    "Circuit breaker state checked"
                );

                match state {
                    CircuitState::Closed => {
                        ServiceHealth::healthy(0).with_circuit_breaker(state_str)
                    }
                    CircuitState::HalfOpen => ServiceHealth {
                        status: HealthStatus::Degraded,
                        response_time_ms: None,
                        circuit_breaker: Some(state_str),
                        error: Some("Circuit breaker in recovery mode".to_string()),
                    },
                    CircuitState::Open => ServiceHealth::degraded_circuit_open(state_str),
                }
            }
            Err(e) => {
                warn!(
                    service = service_name,
                    error = %e,
                    "Failed to check circuit breaker state"
                );
                ServiceHealth::unhealthy(format!("Cannot check circuit breaker: {}", e))
            }
        }
    }

    async fn get_circuit_breaker_state(&self, service_name: &str) -> Result<CircuitState> {
        let client = redis::Client::open(self.config.redis_url.as_str())?;
        let mut conn = client.get_multiplexed_async_connection().await?;

        let key = format!("circuit:{}:state", service_name);
        let value: Option<String> = conn.get(&key).await?;

        Ok(value
            .map(|s| CircuitState::from_string(&s))
            .unwrap_or(CircuitState::Closed))
    }

    fn determine_overall_status(&self, checks: &HashMap<String, ServiceHealth>) -> HealthStatus {
        let has_unhealthy = checks
            .values()
            .any(|health| health.status == HealthStatus::Unhealthy);

        let has_degraded = checks
            .values()
            .any(|health| health.status == HealthStatus::Degraded);

        let critical_unhealthy = checks
            .iter()
            .filter(|(name, _)| {
                name.as_str() == "database"
                    || name.as_str() == "cache_service"
                    || name.as_str() == "message_broker"
            })
            .any(|(_, health)| health.status == HealthStatus::Unhealthy);

        if critical_unhealthy || has_unhealthy {
            HealthStatus::Unhealthy
        } else if has_degraded {
            HealthStatus::Degraded
        } else {
            HealthStatus::Healthy
        }
    }
}
