use anyhow::{Error, Result, anyhow};
use tokio_postgres::{Client, NoTls};
use tracing::{debug, error, info};
use uuid::Uuid;

use crate::models::audit::CreateAuditLog;

pub struct DatabaseClient {
    client: Client,
}

impl DatabaseClient {
    pub async fn connect(database_url: &str) -> Result<Self, Error> {
        info!("Connecting to PostgreSQL database");

        let (client, connection) = tokio_postgres::connect(database_url, NoTls)
            .await
            .map_err(|e| anyhow!("Failed to connect to database: {}", e))?;

        tokio::spawn(async move {
            if let Err(e) = connection.await {
                error!(error = %e, "Database connection error");
            }
        });

        info!("PostgreSQL connection established");

        Ok(Self { client })
    }

    pub async fn log_notification(&self, log: CreateAuditLog) -> Result<(), Error> {
        let user_uuid =
            Uuid::parse_str(&log.user_id).map_err(|e| anyhow!("Invalid user_id format: {}", e))?;

        let status_str = log.status.to_string();

        self.client
            .execute(
                r#"
                INSERT INTO audit_logs (
                    trace_id, 
                    user_id, 
                    notification_type, 
                    template_code, 
                    status, 
                    error_message, 
                    metadata
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                "#,
                &[
                    &log.trace_id,
                    &user_uuid,
                    &log.notification_type,
                    &log.template_code,
                    &status_str,
                    &log.error_message,
                    &log.metadata,
                ],
            )
            .await
            .map_err(|e| {
                error!(
                    error = %e,
                    trace_id = %log.trace_id,
                    "Failed to write audit log to database"
                );
                anyhow!("Database write failed: {}", e)
            })?;

        debug!(
            trace_id = %log.trace_id,
            status = %status_str,
            "Audit log written to database"
        );

        Ok(())
    }

    pub async fn health_check(&self) -> Result<(), Error> {
        self.client
            .query_one("SELECT 1 as check", &[])
            .await
            .map_err(|e| anyhow!("Database health check failed: {}", e))?;

        Ok(())
    }
}
