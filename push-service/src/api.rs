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

use crate::{
    clients::{database::DatabaseClient, health::HealthChecker},
    config::Config,
    models::{health::HealthStatus, response::ApiResponse},
};

pub struct AppState {
    health_checker: HealthChecker,
    database_client: Arc<DatabaseClient>,
}

pub async fn run_api_server(
    config: Config,
    database_client: Arc<DatabaseClient>,
) -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(AppState {
        health_checker: HealthChecker::new(config.clone()),
        database_client,
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .route(
            "/api/v1/push/status/{request_id}",
            get(get_notification_status),
        )
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

    let message = match health.status {
        HealthStatus::Healthy => "All systems operational",
        HealthStatus::Degraded => "Service degraded but operational",
        HealthStatus::Unhealthy => "Service unhealthy",
    };

    let response = ApiResponse::success(health, message.to_string());

    (status_code, Json(response))
}

async fn get_notification_status(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(request_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state
        .database_client
        .get_audit_log_by_trace_id(&request_id)
        .await
    {
        Ok(Some(log)) => {
            let data = serde_json::to_value(&log).unwrap();
            let response = ApiResponse::success(data, "Status retrieved".to_string());
            (StatusCode::OK, Json(response))
        }
        Ok(None) => {
            let response: ApiResponse<serde_json::Value> = ApiResponse::error(
                "Notification not found".to_string(),
                "Not found".to_string(),
            );
            (StatusCode::NOT_FOUND, Json(response))
        }
        Err(e) => {
            let response: ApiResponse<serde_json::Value> =
                ApiResponse::error(e.to_string(), "Database query failed".to_string());
            (StatusCode::INTERNAL_SERVER_ERROR, Json(response))
        }
    }
}
