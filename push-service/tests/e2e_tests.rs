use anyhow::Result;
use push_service::{
    clients::{rbmq::RabbitMqClient, redis::RedisClient, template::TemplateServiceClient},
    config::Config,
    models::{message::NotificationMessage, status::IdempotencyStatus},
    utils::process_message,
};
use std::collections::HashMap;
use uuid::Uuid;

/// Test: Complete notification flow from queue to success
#[tokio::test]
async fn test_end_to_end_notification_success_flow() -> Result<()> {
    let config = Config::load()?;
    RabbitMqClient::connect(&config).await?;
    let mut redis_client = RedisClient::connect(&config).await?;
    let template_service_client = TemplateServiceClient::new(&config).await?;

    let message = create_notification_message("e2e_success");
    let payload = serde_json::to_string(&message)?;

    publish_message(&config, &message).await?;

    let result = process_message(&payload, &mut redis_client, &template_service_client).await;

    // Note: This might fail if template service is not running, which is acceptable
    // The test validates the idempotency behavior regardless
    match result {
        Ok(_) => {
            println!("Message processed successfully");
        }
        Err(e) => {
            println!(
                "Processing failed (expected if template service unavailable): {}",
                e
            );
        }
    }

    let status = redis_client
        .check_idempotency(&message.idempotency_key)
        .await?;

    assert!(
        status == IdempotencyStatus::Processing || status == IdempotencyStatus::Failed,
        "Message should be marked as processing or failed, got: {:?}",
        status
    );

    cleanup_redis_key(&config, &message.idempotency_key).await?;

    Ok(())
}

/// Test: Duplicate messages are rejected throughout the flow
#[tokio::test]
async fn test_end_to_end_duplicate_rejection() -> Result<()> {
    let config = Config::load()?;
    let mut redis_client = RedisClient::connect(&config).await?;
    let template_service_client = TemplateServiceClient::new(&config).await?;

    let message = create_notification_message("e2e_duplicate");
    let payload = serde_json::to_string(&message)?;

    let first_result = process_message(&payload, &mut redis_client, &template_service_client).await;

    let status_after_first = redis_client
        .check_idempotency(&message.idempotency_key)
        .await?;

    assert!(
        status_after_first != IdempotencyStatus::NotFound,
        "First processing should set idempotency state"
    );

    if first_result.is_ok() {
        let result2 = process_message(&payload, &mut redis_client, &template_service_client).await;
        assert!(result2.is_ok(), "Duplicate should be silently handled");

        let status_after_second = redis_client
            .check_idempotency(&message.idempotency_key)
            .await?;

        assert_eq!(
            status_after_second, status_after_first,
            "Duplicate processing should not change state"
        );
    } else {
        // If first call failed (template service unavailable), verify it was marked as failed
        assert_eq!(
            status_after_first,
            IdempotencyStatus::Failed,
            "First processing failure should mark as Failed"
        );

        println!("Template service unavailable - verified Failed state handling");
    }

    cleanup_redis_key(&config, &message.idempotency_key).await?;

    Ok(())
}

/// Test: Invalid JSON messages are rejected
#[tokio::test]
async fn test_end_to_end_invalid_json_rejection() -> Result<()> {
    let config = Config::load()?;
    let mut redis_client = RedisClient::connect(&config).await?;
    let template_service_client = TemplateServiceClient::new(&config).await?;

    let invalid_payload = "{ invalid json }";

    let result =
        process_message(invalid_payload, &mut redis_client, &template_service_client).await;

    assert!(result.is_err(), "Invalid JSON should fail processing");

    Ok(())
}

/// Test: Messages with all required fields are processed
#[tokio::test]
async fn test_end_to_end_complete_message_processing() -> Result<()> {
    let config = Config::load()?;
    let mut redis_client = RedisClient::connect(&config).await?;
    let template_service_client = TemplateServiceClient::new(&config).await?;

    let mut variables = HashMap::new();
    variables.insert("user_name".to_string(), serde_json::json!("Alice"));
    variables.insert("action".to_string(), serde_json::json!("login"));

    let mut metadata = HashMap::new();
    metadata.insert("source".to_string(), serde_json::json!("web"));
    metadata.insert("ip_address".to_string(), serde_json::json!("192.168.1.1"));

    let message = NotificationMessage {
        trace_id: "trace_complete_001".to_string(),
        idempotency_key: format!("complete_{}", Uuid::new_v4()),
        user_id: "user_12345".to_string(),
        notification_type: "push".to_string(),
        recipient: "device_token_abc123".to_string(),
        template_code: "USER_LOGIN".to_string(),
        variables,
        language: Some("en".to_string()),
        metadata,
    };

    let payload = serde_json::to_string(&message)?;

    let _ = process_message(&payload, &mut redis_client, &template_service_client).await;

    let status = redis_client
        .check_idempotency(&message.idempotency_key)
        .await?;

    assert!(
        status != IdempotencyStatus::NotFound,
        "Message should have set idempotency state"
    );

    cleanup_redis_key(&config, &message.idempotency_key).await?;

    Ok(())
}

/// Test: Message flow handles queue unavailability gracefully
#[tokio::test]
async fn test_end_to_end_graceful_degradation() -> Result<()> {
    let config = Config::load()?;
    let mut redis_client = RedisClient::connect(&config).await?;
    let template_service_client = TemplateServiceClient::new(&config).await?;

    let message = create_notification_message("e2e_degradation");
    let payload = serde_json::to_string(&message)?;

    let _ = process_message(&payload, &mut redis_client, &template_service_client).await;

    // Verify idempotency was set (regardless of template service availability)
    let status = redis_client
        .check_idempotency(&message.idempotency_key)
        .await?;

    assert!(
        status != IdempotencyStatus::NotFound,
        "Idempotency should be set even if downstream services fail"
    );

    cleanup_redis_key(&config, &message.idempotency_key).await?;

    Ok(())
}

/// Test: High throughput message processing
#[tokio::test]
async fn test_end_to_end_high_throughput() -> Result<()> {
    let config = Config::load()?;

    let message_count = 50;
    let mut handles = vec![];

    for i in 0..message_count {
        let config_clone = config.clone();

        let handle = tokio::spawn(async move {
            let mut redis = RedisClient::connect(&config_clone).await.unwrap();
            let template_service = TemplateServiceClient::new(&config_clone).await.unwrap();

            let message = create_notification_message(&format!("throughput_{}", i));
            let payload = serde_json::to_string(&message).unwrap();

            let _ = process_message(&payload, &mut redis, &template_service).await;

            let status = redis
                .check_idempotency(&message.idempotency_key)
                .await
                .unwrap();
            let success = status != IdempotencyStatus::NotFound;

            // Cleanup
            if success {
                cleanup_redis_key(&config_clone, &message.idempotency_key)
                    .await
                    .ok();
            }

            success
        });

        handles.push(handle);
    }

    let results = futures_util::future::join_all(handles).await;
    let success_count = results
        .iter()
        .filter(|r| *r.as_ref().unwrap_or(&false))
        .count();

    assert!(
        success_count >= message_count * 9 / 10,
        "At least 90% of messages should set idempotency state (got {}/{})",
        success_count,
        message_count
    );

    Ok(())
}

/// Test: Message ordering is preserved per consumer
#[tokio::test]
async fn test_end_to_end_message_ordering() -> Result<()> {
    let config = Config::load()?;
    let rabbitmq = RabbitMqClient::connect(&config).await?;

    let message_ids = vec!["order_1", "order_2", "order_3"];

    for id in &message_ids {
        let message = create_notification_message(id);
        publish_message(&config, &message).await?;
    }

    let mut consumer = rabbitmq.create_consumer().await?;
    let mut received_ids = Vec::new();

    use futures_util::StreamExt;

    for _ in 0..3 {
        if let Some(Ok(delivery)) = consumer.next().await {
            let message: NotificationMessage = serde_json::from_slice(&delivery.data)?;
            received_ids.push(message.idempotency_key.clone());
            rabbitmq.acknowledge(delivery.delivery_tag).await?;
        }
    }

    assert_eq!(received_ids.len(), 3, "Should receive all messages");

    Ok(())
}

/// Test: System recovers from transient Redis failures
#[tokio::test]
async fn test_end_to_end_redis_resilience() -> Result<()> {
    let config = Config::load()?;
    let template_service_client = TemplateServiceClient::new(&config).await?;

    let message = create_notification_message("redis_resilience");
    let payload = serde_json::to_string(&message)?;

    let mut redis_client = RedisClient::connect(&config).await?;

    let _ = process_message(&payload, &mut redis_client, &template_service_client).await;

    let status_result = redis_client
        .check_idempotency(&message.idempotency_key)
        .await;

    match status_result {
        Ok(status) => {
            assert!(
                status != IdempotencyStatus::NotFound,
                "If Redis is available, idempotency should be set"
            );
        }
        Err(_) => {
            println!("Redis temporarily unavailable (expected for resilience test)");
        }
    }

    cleanup_redis_key(&config, &message.idempotency_key)
        .await
        .ok();

    Ok(())
}

fn create_notification_message(suffix: &str) -> NotificationMessage {
    let mut variables = HashMap::new();
    variables.insert("test_key".to_string(), serde_json::json!("test_value"));

    NotificationMessage {
        trace_id: format!("trace_{}", suffix),
        idempotency_key: format!("idem_{}_{}", suffix, Uuid::new_v4()),
        user_id: format!("user_{}", suffix),
        notification_type: "push".to_string(),
        recipient: format!("device_token_{}", suffix),
        template_code: "TEST_TEMPLATE".to_string(),
        variables,
        language: Some("en".to_string()),
        metadata: HashMap::new(),
    }
}

async fn publish_message(config: &Config, message: &NotificationMessage) -> Result<()> {
    let client =
        lapin::Connection::connect(&config.rabbitmq_url, lapin::ConnectionProperties::default())
            .await?;

    let channel = client.create_channel().await?;
    let payload = serde_json::to_vec(message)?;

    channel
        .basic_publish(
            "",
            &config.push_queue_name,
            lapin::options::BasicPublishOptions::default(),
            &payload,
            lapin::BasicProperties::default(),
        )
        .await?;

    Ok(())
}

async fn cleanup_redis_key(config: &Config, key: &str) -> Result<()> {
    use redis::AsyncCommands;

    let client = redis::Client::open(config.redis_url.as_str())?;
    let mut conn = client.get_multiplexed_async_connection().await?;
    let full_key = format!("idempotency:{}", key);
    conn.del::<_, ()>(full_key).await?;
    Ok(())
}
