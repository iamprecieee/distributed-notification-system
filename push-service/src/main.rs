use anyhow::{Error, Result};
use chrono::{SecondsFormat, Utc};
use push_service::{
    clients::{
        fcm::FcmClient, rbmq::RabbitMqClient, redis::RedisClient, template::TemplateServiceClient,
    },
    config::Config,
    models::message::{DlqMessage, NotificationMessage},
    utils::process_message,
};

use futures_util::StreamExt;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let config = Config::load()?;

    println!("Configuration validated. Worker is ready to start.");

    let rabbitmq_client = RabbitMqClient::connect(&config).await?;
    let mut consumer = rabbitmq_client.create_consumer().await?;

    let mut redis_client = RedisClient::connect(&config).await?;

    let template_service_client = TemplateServiceClient::new(&config).await?;

    let fcm_client = FcmClient::new(&config).await;

    while let Some(delivery) = consumer.next().await {
        match delivery {
            Ok(delivery) => {
                let delivery_tag = delivery.delivery_tag;
                let payload = String::from_utf8_lossy(&delivery.data);

                match process_message(
                    &payload,
                    &mut redis_client,
                    &template_service_client,
                    &fcm_client,
                )
                .await
                {
                    Ok(_) => {
                        println!("Message processed successfully");
                        rabbitmq_client.acknowledge(delivery_tag).await?;
                    }
                    Err(e) => {
                        eprintln!("Failed to process message: {}", e);

                        match serde_json::from_str::<NotificationMessage>(&payload) {
                            Ok(original_message) => {
                                let dlq_message = DlqMessage {
                                    original_message,
                                    failure_reason: e.to_string(),
                                    failed_at: Utc::now()
                                        .to_rfc3339_opts(SecondsFormat::Millis, true),
                                };

                                if let Err(dlq_err) =
                                    rabbitmq_client.publish_to_dlq(&dlq_message).await
                                {
                                    eprintln!("Failed to publish to DLQ: {}", dlq_err);
                                }
                            }
                            Err(parse_err) => {
                                eprintln!(
                                    "Cannot parse message as JSON: {}. Raw payload: {}",
                                    parse_err, payload
                                );
                            }
                        }

                        if let Err(reject_err) = rabbitmq_client.reject(delivery_tag, false).await {
                            eprintln!("Failed to reject message: {}", reject_err);
                        }
                    }
                }
            }
            Err(_) => {
                eprintln!("Error receiving message");
            }
        }
    }

    println!("Consumer closed, shutting down");

    Ok(())
}
