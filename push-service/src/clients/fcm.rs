use std::collections::HashMap;

use anyhow::{Error, Result, anyhow};
use reqwest::Client;

use crate::{
    config::Config,
    models::{
        fcm::{FcmNotification, FcmPayload},
        retry::RetryConfig,
    },
    utils::retry_with_backoff,
};

pub struct FcmClient {
    http_client: Client,
    fcm_project_id: String,
    retry_config: RetryConfig,
}

impl FcmClient {
    pub async fn new(config: &Config) -> Self {
        Self {
            http_client: Client::new(),
            fcm_project_id: config.fcm_project_id.clone(),
            retry_config: RetryConfig::from_config(config),
        }
    }

    pub async fn send_notification(
        &self,
        device_token: &str,
        title: &str,
        body: &str,
        trace_id: &str,
        data: Option<HashMap<String, String>>,
    ) -> Result<(), Error> {
        let device_token = device_token.to_string();
        let mut payload_data = data.unwrap_or_default();
        payload_data.insert("trace_id".to_string(), trace_id.to_string());

        let payload = FcmPayload {
            to: device_token.to_string(),
            notification: FcmNotification {
                title: title.to_string(),
                body: body.to_string(),
            },
            data: Some(payload_data),
        };

        retry_with_backoff(&self.retry_config, || self.send_notification_once(&payload)).await
    }

    async fn send_notification_once(&self, payload: &FcmPayload) -> Result<(), Error> {
        let provider = gcp_auth::provider().await?;
        let scopes = &["https://www.googleapis.com/auth/firebase.messaging"];

        let token = provider.token(scopes).await?;

        let url = format!(
            "https://fcm.googleapis.com/v1/projects/{}/messages:send",
            self.fcm_project_id
        );

        let response = self
            .http_client
            .post(&url)
            .bearer_auth(token.as_str())
            .json(&payload)
            .send()
            .await?;

        if response.status().is_success() {
            println!("FCM push notification sent successfully");
            Ok(())
        } else {
            let error_text = response.text().await?;
            Err(anyhow!("FCM request failed: {}", error_text))
        }
    }
}
