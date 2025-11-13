use anyhow::{Error, Result, anyhow};
use tokio::time::{Duration, sleep};
use tracing::{debug, info, warn};

use crate::{
    clients::{
        database::DatabaseClient, fcm::FcmClient, redis::RedisClient,
        template::TemplateServiceClient,
    },
    config::Config,
    models::{
        audit::CreateAuditLog,
        message::{Envelope},
        retry::RetryConfig,
        status::{IdempotencyStatus, NotificationStatus},
        validation::validate_fcm_token,
    },
};

pub async fn process_message(
    payload: &str,
    redis_client: &mut RedisClient,
    template_service_client: &mut TemplateServiceClient,
    fcm_client: &mut FcmClient,
    database_client: &DatabaseClient,
) -> Result<(), Error> {
    info!("Raw payload: {}", payload);
    let enveloped = serde_json::from_str::<Envelope>(payload)?;
    let message = enveloped.data;

    info!(
        request_id = %message.request_id,
        idempotency_key = %message.idempotency_key,
        user_id = %message.user_id,
        "Processing notification message"
    );

    match redis_client
        .check_idempotency(&message.idempotency_key)
        .await
    {
        Ok(IdempotencyStatus::Sent) => {
            info!(
                idempotency_key = %message.idempotency_key,
                "Message already processed, skipping"
            );
            return Ok(());
        }
        Ok(IdempotencyStatus::Processing) => {
            info!(
                idempotency_key = %message.idempotency_key,
                "Message is being processed elsewhere, skipping"
            );
            return Ok(());
        }
        _ => {}
    }

    redis_client
        .mark_as_processing(&message.idempotency_key)
        .await?;

    let device_token = message
        .metadata
        .get("push_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("Missing push_token in metadata"))?;

    if let Err(e) = validate_fcm_token(device_token) {
        redis_client
            .mark_as_failed(&message.idempotency_key)
            .await?;

        let audit_log = CreateAuditLog::new(
            message.request_id.clone(),
            message.user_id.clone(),
            message.notification_type.clone(),
            message.template_code.clone(),
            NotificationStatus::Failed,
        )
        .with_error(format!("Invalid device token: {}", e))
        .with_metadata(serde_json::to_value(message.metadata.clone())?);

        if let Err(log_err) = database_client.log_notification(audit_log).await {
            warn!(error = %log_err, "Failed to write audit log");
        }

        return Err(anyhow!("Invalid device token: {}", e));
    }

    // Use English as default language for now
    let language = "en";

    let template = match template_service_client
        .fetch_template(&message.template_code, Some(language))
        .await
    {
        Ok(template) => template,
        Err(e) => {
            redis_client
                .mark_as_failed(&message.idempotency_key)
                .await?;

            let audit_log = CreateAuditLog::new(
                message.request_id.clone(),
                message.user_id.clone(),
                message.notification_type.clone(),
                message.template_code.clone(),
                NotificationStatus::Failed,
            )
            .with_error(format!("Template fetch failed: {}", e))
            .with_metadata(serde_json::to_value(message.metadata.clone())?);

            if let Err(log_err) = database_client.log_notification(audit_log).await {
                warn!(error = %log_err, "Failed to write audit log");
            }

            return Err(anyhow!("Failed to fetch template: {}", e));
        }
    };

    let rendered = match template_service_client.render_template(&template, &message.variables) {
        Ok(rendered) => {
            debug!(template_code = %message.template_code, "Template rendered successfully");
            rendered
        }
        Err(e) => {
            redis_client
                .mark_as_failed(&message.idempotency_key)
                .await?;

            let audit_log = CreateAuditLog::new(
                message.request_id.clone(),
                message.user_id.clone(),
                message.notification_type.clone(),
                message.template_code.clone(),
                NotificationStatus::Failed,
            )
            .with_error(format!("Template render failed: {}", e))
            .with_metadata(serde_json::to_value(message.metadata.clone())?);

            if let Err(log_err) = database_client.log_notification(audit_log).await {
                warn!(error = %log_err, "Failed to write audit log");
            }

            return Err(anyhow!("Failed to render template: {}", e));
        }
    };

    match fcm_client
        .send_notification(
            device_token,
            &rendered.title,
            &rendered.body,
            &message.request_id,
            None,
        )
        .await
    {
        Ok(_) => {
            redis_client.mark_as_sent(&message.idempotency_key).await?;

            let audit_log = CreateAuditLog::new(
                message.request_id.clone(),
                message.user_id.clone(),
                message.notification_type.clone(),
                message.template_code.clone(),
                NotificationStatus::Sent,
            )
            .with_metadata(serde_json::to_value(message.metadata.clone())?);

            if let Err(log_err) = database_client.log_notification(audit_log).await {
                warn!(error = %log_err, "Failed to write audit log");
            }

            info!(
                request_id = %message.request_id,
                idempotency_key = %message.idempotency_key,
                "Notification sent successfully"
            );
            Ok(())
        }
        Err(e) => {
            redis_client
                .mark_as_failed(&message.idempotency_key)
                .await?;

            let audit_log = CreateAuditLog::new(
                message.request_id.clone(),
                message.user_id.clone(),
                message.notification_type.clone(),
                message.template_code.clone(),
                NotificationStatus::Failed,
            )
            .with_error(format!("FCM send failed: {}", e))
            .with_metadata(serde_json::to_value(message.metadata.clone())?);

            if let Err(log_err) = database_client.log_notification(audit_log).await {
                warn!(error = %log_err, "Failed to write audit log");
            }

            Err(anyhow!("Notification failed: {}", e))
        }
    }
}

impl RetryConfig {
    pub fn from_config(config: &Config) -> Self {
        Self {
            max_attempts: config.max_retry_attempts,
            initial_delay_ms: config.initial_retry_delay_ms,
            max_delay_ms: config.max_retry_delay_ms,
            backoff_multiplier: config.retry_backoff_multiplier,
        }
    }
}

pub async fn retry_with_backoff<F, Fut, T, E>(config: &RetryConfig, operation: F) -> Result<T, E>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let mut attempt = 0;
    let mut delay_ms = config.initial_delay_ms;

    loop {
        attempt += 1;

        match operation().await {
            Ok(result) => {
                if attempt > 1 {
                    info!(
                        attempt,
                        max_attempts = config.max_attempts,
                        "Retry succeeded"
                    );
                }
                return Ok(result);
            }
            Err(e) => {
                if attempt >= config.max_attempts {
                    warn!(
                        max_attempts = config.max_attempts,
                        error = %e,
                        "Retry failed after exhausting all attempts"
                    );
                    return Err(e);
                }

                debug!(
                    attempt,
                    max_attempts = config.max_attempts,
                    delay_ms,
                    "Retry attempt failed, backing off"
                );

                let jitter = rand::random_range(-0.1..=0.1);

                let jittered_delay = (delay_ms as f64 * (1.0 + jitter)) as u64;

                sleep(Duration::from_millis(jittered_delay)).await;

                delay_ms = std::cmp::min(delay_ms * config.backoff_multiplier, config.max_delay_ms);
            }
        }
    }
}
