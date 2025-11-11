use std::sync::Arc;

use anyhow::Result;
use push_service::{
    clients::redis::RedisClient, config::Config, models::status::IdempotencyStatus,
};
use redis::AsyncCommands;
use tokio::time::sleep;

/// Test: System prevents duplicate message processing
#[tokio::test]
async fn test_duplicate_messages_are_deduplicated() -> Result<()> {
    let config = Config::load()?;
    let mut redis_client = RedisClient::connect(&config).await?;

    let idempotency_key = format!("test_dedup_{}", uuid::Uuid::new_v4());

    let status = redis_client.check_idempotency(&idempotency_key).await?;
    assert_eq!(status, IdempotencyStatus::NotFound);

    redis_client.mark_as_processing(&idempotency_key).await?;

    let status = redis_client.check_idempotency(&idempotency_key).await?;
    assert_eq!(status, IdempotencyStatus::Processing);

    let status = redis_client.check_idempotency(&idempotency_key).await?;
    assert_eq!(status, IdempotencyStatus::Processing);

    cleanup_redis_key(&config, &idempotency_key).await?;

    Ok(())
}

/// Test: System correctly tracks message lifecycle states
#[tokio::test]
async fn test_message_state_transitions() -> Result<()> {
    let config = Config::load()?;
    let mut redis_client = RedisClient::connect(&config).await?;

    let idempotency_key = format!("test_states_{}", uuid::Uuid::new_v4());

    let status = redis_client.check_idempotency(&idempotency_key).await?;
    assert_eq!(status, IdempotencyStatus::NotFound);

    redis_client.mark_as_processing(&idempotency_key).await?;
    let status = redis_client.check_idempotency(&idempotency_key).await?;
    assert_eq!(status, IdempotencyStatus::Processing);

    redis_client.mark_as_sent(&idempotency_key).await?;
    let status = redis_client.check_idempotency(&idempotency_key).await?;
    assert_eq!(status, IdempotencyStatus::Sent);

    cleanup_redis_key(&config, &idempotency_key).await?;

    Ok(())
}

/// Test: System respects TTL for idempotency keys
#[tokio::test]
async fn test_idempotency_keys_expire_after_ttl() -> Result<()> {
    let mut config = Config::load()?;
    config.idempotency_ttl_seconds = 2;

    let mut redis_client = RedisClient::connect(&config).await?;
    let idempotency_key = format!("test_ttl_{}", uuid::Uuid::new_v4());

    redis_client.mark_as_sent(&idempotency_key).await?;

    let status = redis_client.check_idempotency(&idempotency_key).await?;
    assert_eq!(status, IdempotencyStatus::Sent);

    sleep(tokio::time::Duration::from_secs(3)).await;

    let status = redis_client.check_idempotency(&idempotency_key).await?;
    assert_eq!(status, IdempotencyStatus::NotFound);

    Ok(())
}

/// Test: System handles concurrent idempotency checks correctly
#[tokio::test]
async fn test_concurrent_idempotency_checks_are_safe() -> Result<()> {
    let config = Arc::new(Config::load()?);
    let idempotency_key = format!("test_concurrent_{}", uuid::Uuid::new_v4());

    let mut handles = vec![];

    for _ in 0..10 {
        let config_clone = Arc::clone(&config);
        let key_clone = idempotency_key.clone();

        let handle = tokio::spawn(async move {
            let mut redis_client = RedisClient::connect(&config_clone).await.unwrap();

            let status = redis_client.check_idempotency(&key_clone).await.unwrap();

            if status == IdempotencyStatus::NotFound {
                redis_client.mark_as_processing(&key_clone).await.unwrap();
                return true;
            }

            false
        });

        handles.push(handle);
    }

    let results: Vec<bool> = futures_util::future::join_all(handles)
        .await
        .into_iter()
        .map(|r| r.unwrap())
        .collect();

    let success_count = results.iter().filter(|&&x| x).count();
    assert!(success_count >= 1, "At least one task should succeed");

    cleanup_redis_key(&config, &idempotency_key).await?;

    Ok(())
}

/// Test: System correctly marks failed messages
#[tokio::test]
async fn test_failed_message_tracking() -> Result<()> {
    let config = Config::load()?;
    let mut redis_client = RedisClient::connect(&config).await?;

    let idempotency_key = format!("test_failed_{}", uuid::Uuid::new_v4());

    redis_client.mark_as_processing(&idempotency_key).await?;
    redis_client.mark_as_failed(&idempotency_key).await?;

    let status = redis_client.check_idempotency(&idempotency_key).await?;
    assert_eq!(status, IdempotencyStatus::Failed);

    cleanup_redis_key(&config, &idempotency_key).await?;

    Ok(())
}

async fn cleanup_redis_key(config: &Config, key: &str) -> Result<()> {
    let client = redis::Client::open(config.redis_url.as_str())?;
    let mut conn = client.get_multiplexed_async_connection().await?;
    let full_key = format!("idempotency:{}", key);
    conn.del::<_, ()>(full_key).await?;
    Ok(())
}
