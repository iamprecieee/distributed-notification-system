use std::sync::Arc;

use axum::{
    Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::get,
};
use tokio::net::TcpListener;
use tower_http::trace::TraceLayer;
use tracing::info;

use crate::{clients::health::HealthChecker, config::Config, models::health::HealthStatus};

pub struct AppState {
    health_checker: HealthChecker,
}

pub async fn run_api_server(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(AppState {
        health_checker: HealthChecker::new(config.clone()),
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.server_port);
    let listener = TcpListener::bind(&addr).await?;

    info!(address = %addr, "Health check server started");

    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let health = state.health_checker.check_all().await;

    let status_code = match health.status {
        HealthStatus::Healthy => StatusCode::OK,
        HealthStatus::Degraded => StatusCode::OK,
        HealthStatus::Unhealthy => StatusCode::SERVICE_UNAVAILABLE,
    };

    (status_code, Json(health))
}
