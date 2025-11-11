use std::collections::HashMap;

use anyhow::{Error, Result, anyhow};
use reqwest::Client;
use tracing::{debug, info};

use crate::{
    clients::circuit_breaker::CircuitBreaker,
    config::Config,
    models::{
        fcm::{FcmMessage, FcmNotification, FcmRequest},
        retry::RetryConfig,
    },
    utils::retry_with_backoff,
};

pub struct FcmClient {
    http_client: Client,
    fcm_project_id: String,
    retry_config: RetryConfig,
    circuit_breaker: CircuitBreaker,
}

impl FcmClient {
    pub async fn new(config: &Config, circuit_breaker: CircuitBreaker) -> Self {
        info!(project_id = %config.fcm_project_id, "FCM client initialized");

        Self {
            http_client: Client::new(),
            fcm_project_id: config.fcm_project_id.clone(),
            retry_config: config.retry_config(),
            circuit_breaker,
        }
    }

    pub async fn send_notification(
        &mut self,
        device_token: &str,
        title: &str,
        body: &str,
        trace_id: &str,
        data: Option<HashMap<String, String>>,
    ) -> Result<(), Error> {
        debug!(
            device_token,
            trace_id,
            "Sending FCM push notification"
        );

        let mut payload_data = data.unwrap_or_default();
        payload_data.insert("trace_id".to_string(), trace_id.to_string());

        let message = FcmMessage {
            token: device_token.to_string(),
            notification: FcmNotification {
                title: title.to_string(),
                body: body.to_string(),
            },
            data: Some(payload_data),
        };

        let request = FcmRequest { message };

        let http_client = self.http_client.clone();
        let fcm_project_id = self.fcm_project_id.clone();
        let retry_config = self.retry_config.clone();

        self.circuit_breaker
            .call(|| Self::send_with_retry_static(http_client.clone(), fcm_project_id.clone(), retry_config.clone(), request.clone()))
            .await
    }

    async fn send_with_retry_static(
        http_client: Client,
        fcm_project_id: String,
        retry_config: RetryConfig,
        request: FcmRequest,
    ) -> Result<(), Error> {
        retry_with_backoff(&retry_config, || {
            Self::send_notification_once_static(http_client.clone(), fcm_project_id.clone(), &request)
        })
        .await
    }

    async fn send_notification_once_static(
        http_client: Client,
        fcm_project_id: String,
        request: &FcmRequest,
    ) -> Result<(), Error> {
        let provider = gcp_auth::provider().await?;
        let scopes = &["https://www.googleapis.com/auth/firebase.messaging"];

        let token = provider.token(scopes).await?;

        let url = format!(
            "https://fcm.googleapis.com/v1/projects/{}/messages:send",
            fcm_project_id
        );

        let response = http_client
            .post(&url)
            .bearer_auth(token.as_str())
            .json(&request)
            .send()
            .await?;

        if response.status().is_success() {
            info!("FCM push notification sent successfully");
            Ok(())
        } else {
            let error_text = response.text().await?;
            Err(anyhow!("FCM request failed: {}", error_text))
        }
    }
}