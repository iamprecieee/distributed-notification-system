use std::sync::Arc;

use anyhow::{Error, Result};
use chrono::{SecondsFormat, Utc};
use push_service::{
    api::run_api_server,
    clients::{
        circuit_breaker::CircuitBreaker, database::DatabaseClient, fcm::FcmClient,
        rbmq::RabbitMqClient, redis::RedisClient, template::TemplateServiceClient,
    },
    config::Config,
    models::message::{DlqMessage, NotificationMessage},
    utils::process_message,
};

use futures_util::StreamExt;
use tokio::sync::{Mutex, Semaphore};
use tracing::{error, info, warn};

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_thread_ids(true)
        .with_level(true)
        .with_line_number(true)
        .init();

    let config = Config::load()?;

    info!("Push service starting");
    info!("Configuration validated");

    let health_config = config.clone();
    tokio::spawn(async move {
        if let Err(e) = run_api_server(health_config).await {
            error!(error = %e, "Health check server failed");
        }
    });

    let rabbitmq_client = Arc::new(RabbitMqClient::connect(&config).await?);
    let mut consumer = rabbitmq_client.create_consumer().await?;

    let database_client = Arc::new(DatabaseClient::connect(&config.database_url).await?);

    let redis_client = redis::Client::open(config.redis_url.as_str())?;
    let redis_conn = redis_client.get_multiplexed_async_connection().await?;

    let fcm_circuit_breaker = CircuitBreaker::new(
        "fcm".to_string(),
        redis_conn.clone(),
        config.circuit_breaker_config(),
    );

    let template_circuit_breaker = CircuitBreaker::new(
        "template_service".to_string(),
        redis_conn,
        config.circuit_breaker_config(),
    );

    let template_service_client = Arc::new(Mutex::new(
        TemplateServiceClient::new(&config, template_circuit_breaker).await?,
    ));

    let fcm_client = Arc::new(Mutex::new(
        FcmClient::new(&config, fcm_circuit_breaker).await,
    ));

    let semaphore = Arc::new(Semaphore::new(config.worker_concurrency));

    info!(
        concurrency = config.worker_concurrency,
        "Worker started with concurrency limit"
    );

    while let Some(delivery) = consumer.next().await {
        match delivery {
            Ok(delivery) => {
                let delivery_tag = delivery.delivery_tag;
                let payload = String::from_utf8_lossy(&delivery.data).to_string();

                let rabbitmq_client = Arc::clone(&rabbitmq_client);
                let template_service_client = Arc::clone(&template_service_client);
                let fcm_client = Arc::clone(&fcm_client);
                let database_client = Arc::clone(&database_client);
                let semaphore = Arc::clone(&semaphore);
                let config = config.clone();

                tokio::spawn(async move {
                    let _permit = semaphore.acquire().await.unwrap();

                    let mut redis_client = match RedisClient::connect(&config).await {
                        Ok(client) => client,
                        Err(e) => {
                            error!(error = %e, "Failed to connect to Redis");
                            if let Err(reject_err) =
                                rabbitmq_client.reject(delivery_tag, true).await
                            {
                                error!(error = %reject_err, "Failed to requeue message");
                            }
                            return;
                        }
                    };

                    let mut template_client = template_service_client.lock().await;
                    let mut fcm = fcm_client.lock().await;

                    match process_message(
                        &payload,
                        &mut redis_client,
                        &mut template_client,
                        &mut fcm,
                        &database_client,
                    )
                    .await
                    {
                        Ok(_) => {
                            info!("Message processed successfully");
                            if let Err(ack_err) = rabbitmq_client.acknowledge(delivery_tag).await {
                                error!(error = %ack_err, "Failed to acknowledge message");
                            }
                        }
                        Err(e) => {
                            error!(error = %e, "Failed to process message");

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
                                        error!(error = %dlq_err, "Failed to publish to DLQ");
                                    }
                                }
                                Err(parse_err) => {
                                    error!(
                                        error = %parse_err,
                                        payload = %payload,
                                        "Cannot parse message as JSON"
                                    );
                                }
                            }

                            if let Err(reject_err) =
                                rabbitmq_client.reject(delivery_tag, false).await
                            {
                                error!(error = %reject_err, "Failed to reject message");
                            }
                        }
                    }
                });
            }
            Err(e) => {
                error!(error = ?e, "Error receiving message from queue");
            }
        }
    }

    warn!("Consumer closed, shutting down");

    Ok(())
}
