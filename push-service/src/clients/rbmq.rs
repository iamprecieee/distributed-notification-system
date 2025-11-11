use anyhow::{Error, Result, anyhow};
use lapin::{
    BasicProperties, Channel, Connection, ConnectionProperties, Consumer,
    options::{
        BasicAckOptions, BasicConsumeOptions, BasicPublishOptions, BasicQosOptions,
        BasicRejectOptions, QueueDeclareOptions,
    },
    types::FieldTable,
};
use tracing::{info, debug};

use crate::{config::Config, models::message::DlqMessage};

pub struct RabbitMqClient {
    pub channel: Channel,
    push_queue_name: String,
    failed_queue_name: String,
}

impl RabbitMqClient {
    pub async fn connect(config: &Config) -> Result<Self, Error> {
        info!("Connecting to RabbitMQ");

        let connection = Connection::connect(&config.rabbitmq_url, ConnectionProperties::default())
            .await
            .map_err(|_| anyhow!("Failed to connect to RabbitMQ"))?;

        info!("RabbitMQ connection established");

        let channel = connection
            .create_channel()
            .await
            .map_err(|_| anyhow!("RabbitMQ channel creation failed"))?;

        info!("RabbitMQ channel created");

        channel
            .basic_qos(config.prefetch_count, BasicQosOptions::default())
            .await
            .map_err(|_| anyhow!("Failed to set up QoS"))?;

        info!(prefetch_count = config.prefetch_count, "Prefetch count set");

        channel
            .queue_declare(
                &config.push_queue_name,
                QueueDeclareOptions {
                    durable: true,
                    ..Default::default()
                },
                FieldTable::default(),
            )
            .await
            .map_err(|_| anyhow!("Failed to declare push queue"))?;

        info!(queue = %config.push_queue_name, "Push queue declared");

        channel
            .queue_declare(
                &config.failed_queue_name,
                QueueDeclareOptions {
                    durable: true,
                    ..Default::default()
                },
                FieldTable::default(),
            )
            .await
            .map_err(|_| anyhow!("Failed to declare failed queue"))?;

        info!(queue = %config.failed_queue_name, "Failed queue declared");

        Ok(Self {
            channel,
            push_queue_name: config.push_queue_name.clone(),
            failed_queue_name: config.failed_queue_name.clone(),
        })
    }

    pub async fn create_consumer(&self) -> Result<Consumer, Error> {
        let consumer = self
            .channel
            .basic_consume(
                &self.push_queue_name,
                "push_worker",
                BasicConsumeOptions::default(),
                FieldTable::default(),
            )
            .await
            .map_err(|_| anyhow!("Failed to create consumer"))?;

        info!(queue = %self.push_queue_name, "Consumer created");

        Ok(consumer)
    }

    pub async fn acknowledge(&self, delivery_tag: u64) -> Result<(), Error> {
        self.channel
            .basic_ack(delivery_tag, BasicAckOptions::default())
            .await
            .map_err(|_| anyhow!("Failed to acknowledge message"))?;

        debug!(delivery_tag, "Message acknowledged");

        Ok(())
    }

    pub async fn reject(&self, delivery_tag: u64, requeue: bool) -> Result<(), Error> {
        self.channel
            .basic_reject(delivery_tag, BasicRejectOptions { requeue })
            .await
            .map_err(|_| anyhow!("Failed to reject message"))?;

        debug!(delivery_tag, requeue, "Message rejected");

        Ok(())
    }

    pub async fn publish_to_dlq(&self, message: &DlqMessage) -> Result<(), Error> {
        let payload = serde_json::to_vec(message)?;

        self.channel
            .basic_publish(
                "",
                &self.failed_queue_name,
                BasicPublishOptions::default(),
                &payload,
                BasicProperties::default().with_delivery_mode(2),
            )
            .await
            .map_err(|_| anyhow!("Failed to publish message to dlq"))?;

        debug!(
            idempotency_key = %message.original_message.idempotency_key,
            reason = %message.failure_reason,
            "Message published to DLQ"
        );

        Ok(())
    }
}