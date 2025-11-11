use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckResponse {
    pub status: HealthStatus,
    pub timestamp: DateTime<Utc>,
    pub checks: HashMap<String, ServiceHealth>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHealth {
    pub status: HealthStatus,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_time_ms: Option<u64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub circuit_breaker: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ServiceHealth {
    pub fn healthy(response_time_ms: u64) -> Self {
        Self {
            status: HealthStatus::Healthy,
            response_time_ms: Some(response_time_ms),
            circuit_breaker: None,
            error: None,
        }
    }

    pub fn unhealthy(error: String) -> Self {
        Self {
            status: HealthStatus::Unhealthy,
            response_time_ms: None,
            circuit_breaker: None,
            error: Some(error),
        }
    }

    pub fn with_circuit_breaker(mut self, state: String) -> Self {
        self.circuit_breaker = Some(state);
        self
    }

    pub fn degraded_circuit_open(circuit_state: String) -> Self {
        Self {
            status: HealthStatus::Degraded,
            response_time_ms: None,
            circuit_breaker: Some(circuit_state),
            error: None,
        }
    }
}
