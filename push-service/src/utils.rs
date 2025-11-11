use anyhow::{Error, Result, anyhow};
use tokio::time::{Duration, sleep};
use tracing::{debug, info, warn};

use crate::{
    clients::{fcm::FcmClient, redis::RedisClient, template::TemplateServiceClient},
    config::Config,
    models::{message::NotificationMessage, retry::RetryConfig, status::IdempotencyStatus},
};

pub async fn process_message(
    payload: &str,
    redis_client: &mut RedisClient,
    template_service_client: &mut TemplateServiceClient,
    fcm_client: &mut FcmClient,
) -> Result<(), Error> {
    let message = serde_json::from_str::<NotificationMessage>(payload)?;

    info!(
        trace_id = %message.trace_id,
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

    let language = message.language.as_deref().unwrap_or("en");
    let template = match template_service_client
        .fetch_template(&message.template_code, Some(language))
        .await
    {
        Ok(template) => template,
        Err(e) => {
            redis_client
                .mark_as_failed(&message.idempotency_key)
                .await?;
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
            return Err(anyhow!("Failed to render template: {}", e));
        }
    };

    match fcm_client
        .send_notification(
            &message.recipient,
            &rendered.title,
            &rendered.body,
            &message.trace_id,
            None,
        )
        .await
    {
        Ok(_) => {
            redis_client.mark_as_sent(&message.idempotency_key).await?;

            info!(
                trace_id = %message.trace_id,
                idempotency_key = %message.idempotency_key,
                "Notification sent successfully"
            );
            Ok(())
        }
        Err(e) => {
            redis_client
                .mark_as_failed(&message.idempotency_key)
                .await?;

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
