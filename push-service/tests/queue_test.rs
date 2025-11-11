use std::collections::HashMap;

use chrono::{SecondsFormat, Utc};
// use anyhow::Result;
// use push_service::{
//     clients::rbmq::RabbitMqClient,
//     config::Config,
//     models::message::{DlqMessage, NotificationMessage},
// };
// use chrono::{SecondsFormat, Utc};
// use lapin::{options::BasicConsumeOptions, types::FieldTable};
// use std::collections::HashMap;
use futures_util::StreamExt;

use anyhow::Result;
use lapin::{
    Connection, ConnectionProperties,
    options::{BasicAckOptions, BasicConsumeOptions, QueueDeclareOptions},
    types::FieldTable,
};
use push_service::{
    clients::rbmq::RabbitMqClient,
    config::Config,
    models::message::{DlqMessage, NotificationMessage},
};
use tokio::time::sleep;

/// Test: Valid messages are successfully acknowledged
#[tokio::test]
async fn test_valid_messages_are_acknowledged() -> Result<()> {
    let config = Config::load()?;
    let rabbitmq = RabbitMqClient::connect(&config).await?;

    let test_message = create_test_notification_message("test_ack");
    publish_test_message(&config, &test_message).await?;

    let mut consumer = rabbitmq.create_consumer().await?;

    if let Some(Ok(delivery)) = consumer.next().await {
        let received: NotificationMessage = serde_json::from_slice(&delivery.data)?;

        assert_eq!(received.idempotency_key, test_message.idempotency_key);

        rabbitmq.acknowledge(delivery.delivery_tag).await?;
    }

    Ok(())
}

/// Test: Failed messages are routed to Dead Letter Queue
#[tokio::test]
async fn test_failed_messages_route_to_dlq() -> Result<()> {
    let config = Config::load()?;
    let rabbitmq = RabbitMqClient::connect(&config).await?;

    let original_message = create_test_notification_message("test_dlq");

    let dlq_message = DlqMessage {
        original_message: original_message.clone(),
        failure_reason: "Test failure".to_string(),
        failed_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
    };

    rabbitmq.publish_to_dlq(&dlq_message).await?;

    let dlq_message_retrieved = consume_from_dlq(&config).await?;

    assert_eq!(
        dlq_message_retrieved.original_message.idempotency_key,
        original_message.idempotency_key
    );
    assert_eq!(dlq_message_retrieved.failure_reason, "Test failure");

    Ok(())
}

/// Test: Rejected messages are not requeued
#[tokio::test]
async fn test_rejected_messages_not_requeued() -> Result<()> {
    let config = Config::load()?;
    let rabbitmq = RabbitMqClient::connect(&config).await?;

    let test_message = create_test_notification_message("test_reject");

    let initial_count = get_queue_message_count(&config).await?;

    publish_test_message(&config, &test_message).await?;

    let mut consumer = rabbitmq.create_consumer().await?;

    if let Some(Ok(delivery)) = consumer.next().await {
        let delivery_tag = delivery.delivery_tag;

        rabbitmq.reject(delivery_tag, false).await?;
    }

    sleep(tokio::time::Duration::from_millis(500)).await;

    let final_count = get_queue_message_count(&config).await?;

    assert_eq!(
        final_count, initial_count,
        "Queue should have same count as before (message not requeued)"
    );

    Ok(())
}

/// Test: Multiple consumers can process messages concurrently
#[tokio::test]
async fn test_concurrent_message_processing() -> Result<()> {
    let config = Config::load()?;

    for i in 0..5 {
        let message = create_test_notification_message(&format!("concurrent_{}", i));
        publish_test_message(&config, &message).await?;
    }

    let config_clone1 = config.clone();
    let config_clone2 = config.clone();

    let handle1 = tokio::spawn(async move {
        let rabbitmq = RabbitMqClient::connect(&config_clone1).await.unwrap();
        let mut consumer = rabbitmq.create_consumer().await.unwrap();
        let mut count = 0;

        while let Some(Ok(delivery)) = consumer.next().await {
            rabbitmq.acknowledge(delivery.delivery_tag).await.unwrap();
            count += 1;
            if count >= 3 {
                break;
            }
        }
        count
    });

    let handle2 = tokio::spawn(async move {
        let rabbitmq = RabbitMqClient::connect(&config_clone2).await.unwrap();
        let mut consumer = rabbitmq.create_consumer().await.unwrap();
        let mut count = 0;

        while let Some(Ok(delivery)) = consumer.next().await {
            rabbitmq.acknowledge(delivery.delivery_tag).await.unwrap();
            count += 1;
            if count >= 2 {
                break;
            }
        }
        count
    });

    let (count1, count2) = tokio::join!(handle1, handle2);
    let total = count1.unwrap() + count2.unwrap();

    assert_eq!(total, 5, "Both consumers should process all messages");

    Ok(())
}

/// Test: Messages preserve their structure through the queue
#[tokio::test]
async fn test_message_structure_preservation() -> Result<()> {
    let config = Config::load()?;
    let rabbitmq = RabbitMqClient::connect(&config).await?;

    let mut variables = HashMap::new();
    variables.insert("user_name".to_string(), serde_json::json!("John Doe"));
    variables.insert("amount".to_string(), serde_json::json!(100.50));

    let mut metadata = HashMap::new();
    metadata.insert("priority".to_string(), serde_json::json!("high"));

    let original = NotificationMessage {
        trace_id: "trace_123".to_string(),
        idempotency_key: format!("test_structure_{}", uuid::Uuid::new_v4()),
        user_id: "user_456".to_string(),
        notification_type: "push".to_string(),
        recipient: "device_token_789".to_string(),
        template_code: "WELCOME".to_string(),
        variables: variables.clone(),
        language: Some("en".to_string()),
        metadata: metadata.clone(),
    };

    publish_test_message(&config, &original).await?;

    let mut consumer = rabbitmq.create_consumer().await?;

    if let Some(Ok(delivery)) = consumer.next().await {
        let received: NotificationMessage = serde_json::from_slice(&delivery.data)?;

        assert_eq!(received.trace_id, original.trace_id);
        assert_eq!(received.user_id, original.user_id);
        assert_eq!(received.template_code, original.template_code);
        assert_eq!(
            received.variables.get("user_name"),
            Some(&serde_json::json!("John Doe"))
        );
        assert_eq!(
            received.metadata.get("priority"),
            Some(&serde_json::json!("high"))
        );

        rabbitmq.acknowledge(delivery.delivery_tag).await?;
    }

    Ok(())
}

/// Test: DLQ messages contain failure context
#[tokio::test]
async fn test_dlq_messages_contain_failure_context() -> Result<()> {
    let config = Config::load()?;
    let rabbitmq = RabbitMqClient::connect(&config).await?;

    let original = create_test_notification_message("test_context");
    let failure_time = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);

    let dlq_message = DlqMessage {
        original_message: original.clone(),
        failure_reason: "FCM connection timeout".to_string(),
        failed_at: failure_time.clone(),
    };

    rabbitmq.publish_to_dlq(&dlq_message).await?;

    let retrieved = consume_from_dlq(&config).await?;

    assert_eq!(retrieved.failure_reason, "FCM connection timeout");
    assert!(!retrieved.failed_at.is_empty());
    assert_eq!(retrieved.original_message.trace_id, original.trace_id);

    Ok(())
}

fn create_test_notification_message(suffix: &str) -> NotificationMessage {
    let mut variables = HashMap::new();
    variables.insert("key".to_string(), serde_json::json!("value"));

    NotificationMessage {
        trace_id: format!("trace_{}", suffix),
        idempotency_key: format!("idem_{}_{}", suffix, uuid::Uuid::new_v4()),
        user_id: format!("user_{}", suffix),
        notification_type: "push".to_string(),
        recipient: format!("token_{}", suffix),
        template_code: "TEST_TEMPLATE".to_string(),
        variables,
        language: Some("en".to_string()),
        metadata: HashMap::new(),
    }
}

async fn publish_test_message(config: &Config, message: &NotificationMessage) -> Result<()> {
    let rabbitmq = RabbitMqClient::connect(config).await?;
    let payload = serde_json::to_vec(message)?;

    rabbitmq
        .channel
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

async fn consume_from_dlq(config: &Config) -> Result<DlqMessage> {
    let connection =
        Connection::connect(&config.rabbitmq_url, ConnectionProperties::default()).await?;

    let channel = connection.create_channel().await?;

    let mut consumer = channel
        .basic_consume(
            &config.failed_queue_name,
            "test_dlq_consumer",
            BasicConsumeOptions::default(),
            FieldTable::default(),
        )
        .await?;

    if let Some(Ok(delivery)) = consumer.next().await {
        let dlq_message: DlqMessage = serde_json::from_slice(&delivery.data)?;
        channel
            .basic_ack(delivery.delivery_tag, BasicAckOptions::default())
            .await?;
        return Ok(dlq_message);
    }

    Err(anyhow::anyhow!("No message in DLQ"))
}

async fn get_queue_message_count(config: &Config) -> Result<u32> {
    let connection =
        Connection::connect(&config.rabbitmq_url, ConnectionProperties::default()).await?;

    let channel = connection.create_channel().await?;

    let queue = channel
        .queue_declare(
            &config.push_queue_name,
            QueueDeclareOptions {
                passive: true,
                ..Default::default()
            },
            FieldTable::default(),
        )
        .await?;

    Ok(queue.message_count())
}
