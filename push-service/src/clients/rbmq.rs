use anyhow::{Error, Result, anyhow};
use lapin::{
    BasicProperties, Channel, Connection, ConnectionProperties, Consumer,
    options::{
        BasicAckOptions, BasicConsumeOptions, BasicPublishOptions, BasicQosOptions,
        BasicRejectOptions, QueueDeclareOptions,
    },
    types::FieldTable,
};

use crate::{config::Config, models::message::DlqMessage};

pub struct RabbitMqClient {
    channel: Channel,
    push_queue_name: String,
    failed_queue_name: String,
}

impl RabbitMqClient {
    pub async fn connect(config: &Config) -> Result<Self, Error> {
        println!("Connecting to RabbitMQ...");

        let connection = Connection::connect(&config.rabbitmq_url, ConnectionProperties::default())
            .await
            .map_err(|_| anyhow!("Failed to connect to RabbitMQ"))?;

        println!("RabbitMQ connection established");

        let channel = connection
            .create_channel()
            .await
            .map_err(|_| anyhow!("RabbitMQ channel creation failed"))?;

        println!("RabbitMQ channel created");

        channel
            .basic_qos(config.prefetch_count, BasicQosOptions::default())
            .await
            .map_err(|_| anyhow!("Failed to set up QoS"))?;

        println!("Prefetch count set");

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

        println!("Push queue declared");

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

        println!("Failed queue declared");

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

        println!("Consumer created for queue");

        Ok(consumer)
    }

    pub async fn acknowledge(&self, delivery_tag: u64) -> Result<(), Error> {
        self.channel
            .basic_ack(delivery_tag, BasicAckOptions::default())
            .await
            .map_err(|_| anyhow!("Failed to acknowledge message"))?;

        Ok(())
    }

    pub async fn reject(&self, delivery_tag: u64, requeue: bool) -> Result<(), Error> {
        self.channel
            .basic_reject(delivery_tag, BasicRejectOptions { requeue })
            .await
            .map_err(|_| anyhow!("Failed to reject message"))?;

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

        Ok(())
    }
}
