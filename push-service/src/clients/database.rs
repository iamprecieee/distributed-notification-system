use anyhow::{Error, Result, anyhow};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tracing::{debug, error, info};
use uuid::Uuid;

use crate::models::audit::CreateAuditLog;

pub struct DatabaseClient {
    pool: PgPool,
}

impl DatabaseClient {
    pub async fn connect(database_url: &str) -> Result<Self, Error> {
        info!("Connecting to PostgreSQL database");

        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect(database_url)
            .await
            .map_err(|e| anyhow!("Failed to connect to database: {}", e))?;

        info!("PostgreSQL connection established");

        Ok(Self { pool })
    }

    pub async fn log_notification(&self, log: CreateAuditLog) -> Result<(), Error> {
        let user_uuid =
            Uuid::parse_str(&log.user_id).map_err(|e| anyhow!("Invalid user_id format: {}", e))?;

        let status_str = log.status.to_string();

        sqlx::query!(
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
            log.trace_id,
            user_uuid,
            log.notification_type,
            log.template_code,
            status_str,
            log.error_message,
            log.metadata
        )
        .execute(&self.pool)
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
        sqlx::query!("SELECT 1 as check")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| anyhow!("Database health check failed: {}", e))?;

        Ok(())
    }
}
