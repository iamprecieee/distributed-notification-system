use anyhow::{Error, Result, anyhow};
use tokio::time::{Duration, sleep};

use crate::{
    clients::{redis::RedisClient, template::TemplateServiceClient},
    config::Config,
    models::{message::NotificationMessage, retry::RetryConfig, status::IdempotencyStatus},
};

pub async fn process_message(
    payload: &str,
    redis_client: &mut RedisClient,
    template_service_client: &TemplateServiceClient,
) -> Result<(), Error> {
    let message = serde_json::from_str::<NotificationMessage>(payload)?;

    match redis_client
        .check_idempotency(&message.idempotency_key)
        .await
    {
        Ok(IdempotencyStatus::Sent) => {
            println!("Message already processed, skipping.");
            return Ok(());
        }
        Ok(IdempotencyStatus::Processing) => {
            println!("Message is being processed elsewhere, skipping.");
            return Ok(());
        }
        _ => {}
    }

    println!("Processing notification message");

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

    match template_service_client.render_template(&template, &message.variables) {
        Ok(rendered) => {
            println!("  - Template: Rendered successfully");
            rendered
        }
        Err(e) => {
            redis_client
                .mark_as_failed(&message.idempotency_key)
                .await?;
            return Err(anyhow!("Failed to render template: {}", e));
        }
    };

    Ok(())
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
                    println!(
                        "  - Retry: Succeeded on attempt {}/{}",
                        attempt, config.max_attempts
                    );
                }
                return Ok(result);
            }
            Err(e) => {
                if attempt >= config.max_attempts {
                    println!("  - Retry: Failed after {} attempts", config.max_attempts);
                    return Err(e);
                }

                let jitter = rand::random_range(-0.1..=0.1);

                let jittered_delay = (delay_ms as f64 * (1.0 + jitter)) as u64;

                sleep(Duration::from_millis(jittered_delay)).await;

                delay_ms = std::cmp::min(delay_ms * config.backoff_multiplier, config.max_delay_ms);
            }
        }
    }
}
