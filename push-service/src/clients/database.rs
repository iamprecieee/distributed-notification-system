use anyhow::{Error, Result, anyhow};
use tokio_postgres::{Client, NoTls};
use tracing::{debug, error, info};
use uuid::Uuid;

use crate::models::{audit::CreateAuditLog, status::NotificationStatus};

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

    pub async fn get_audit_log_by_trace_id(
        &self,
        trace_id: &str,
    ) -> Result<Option<CreateAuditLog>, Error> {
        let rows = self
            .client
            .query(
                r#"
                SELECT 
                    trace_id, 
                    user_id, 
                    notification_type, 
                    template_code, 
                    status, 
                    error_message, 
                    metadata
                FROM audit_logs 
                WHERE trace_id = $1 
                ORDER BY created_at DESC 
                LIMIT 1
                "#,
                &[&trace_id],
            )
            .await
            .map_err(|e| anyhow!("Failed to query audit log: {}", e))?;

        if rows.is_empty() {
            return Ok(None);
        }

        let row = &rows[0];

        let user_id: uuid::Uuid = row.get("user_id");
        let status_str: String = row.get("status");

        let status = match status_str.as_str() {
            "queued" => NotificationStatus::Queued,
            "processing" => NotificationStatus::Processing,
            "sent" => NotificationStatus::Sent,
            "failed" => NotificationStatus::Failed,
            "dlq" => NotificationStatus::Dlq,
            _ => NotificationStatus::Failed,
        };

        let log = CreateAuditLog {
            trace_id: row.get("trace_id"),
            user_id: user_id.to_string(),
            notification_type: row.get("notification_type"),
            template_code: row.get("template_code"),
            status,
            error_message: row.get("error_message"),
            metadata: row.get("metadata"),
        };

        Ok(Some(log))
    }
}
