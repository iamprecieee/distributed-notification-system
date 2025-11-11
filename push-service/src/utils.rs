use anyhow::{Error, Result};
use tokio::time::{Duration, sleep};

use crate::{
    clients::redis::RedisClient,
    models::{message::NotificationMessage, retry::RetryConfig, status::IdempotencyStatus},
};

pub async fn process_message(payload: &str, redis_client: &mut RedisClient) -> Result<(), Error> {
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

    Ok(())
}

pub async fn retry_with_backoff<F, Fut, T, E>(operation: F, config: &RetryConfig) -> Result<T, E>
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

                attempt += 1;
                delay_ms = std::cmp::min(
                    delay_ms * config.backoff_multiplier as u64,
                    config.max_delay_ms,
                );
            }
        }
    }
}
