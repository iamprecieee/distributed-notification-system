use std::{collections::HashMap, time::Duration};

use anyhow::{Error, Result, anyhow};
use reqwest::Client;
use tracing::{debug, info, warn};

use crate::{
    clients::circuit_breaker::CircuitBreaker,
    config::Config,
    models::{
        retry::RetryConfig,
        template::{Template, TemplateContent},
    },
    utils::retry_with_backoff,
};

pub struct TemplateServiceClient {
    http_client: Client,
    base_url: String,
    retry_config: RetryConfig,
    circuit_breaker: CircuitBreaker,
}

impl TemplateServiceClient {
    pub async fn new(config: &Config, circuit_breaker: CircuitBreaker) -> Result<Self, Error> {
        let http_client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| anyhow!("Failed to create HTTP client"))?;

        info!(base_url = %config.template_service_url, "Template service client initialized");

        Ok(Self {
            http_client,
            base_url: config.template_service_url.clone(),
            retry_config: config.retry_config(),
            circuit_breaker,
        })
    }

    pub async fn fetch_template(
        &mut self,
        template_code: &str,
        language: Option<&str>,
    ) -> Result<Template, Error> {
        let language = language.unwrap_or("en");
        let url = format!(
            "{}/api/v1/templates/{}?lang={}",
            self.base_url, template_code, language
        );

        debug!(
            template_code,
            language,
            "Fetching template from service"
        );

        let http_client = self.http_client.clone();
        let retry_config = self.retry_config.clone();

        self.circuit_breaker
            .call(|| Self::fetch_with_retry_static(http_client.clone(), retry_config.clone(), url.clone()))
            .await
    }

    async fn fetch_with_retry_static(
        http_client: Client,
        retry_config: RetryConfig,
        url: String,
    ) -> Result<Template, Error> {
        retry_with_backoff(&retry_config, || {
            let url_clone = url.clone();
            let client = http_client.clone();

            async move {
                let response = client
                    .get(&url_clone)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;

                let status = response.status();

                if status.is_success() {
                    let template: Template = response
                        .json()
                        .await
                        .map_err(|e| format!("Failed to parse template JSON: {}", e))?;
                    Ok(template)
                } else {
                    Err(format!("Template Service returned status {}", status))
                }
            }
        })
        .await
        .map_err(|_| anyhow!("Failed to fetch template"))
    }

    pub fn render_template(
        &self,
        template: &Template,
        variables: &HashMap<String, serde_json::Value>,
    ) -> Result<TemplateContent, Error> {
        debug!(
            template_code = %template.code,
            variable_count = variables.len(),
            "Rendering template"
        );

        let title = Self::replace_variables(&template.content.title, variables)?;
        let body = Self::replace_variables(&template.content.body, variables)?;

        Ok(TemplateContent { title, body })
    }

    fn replace_variables(
        template: &str,
        variables: &HashMap<String, serde_json::Value>,
    ) -> Result<String, Error> {
        let mut result = template.to_string();

        for (key, value) in variables {
            let placeholder = format!("{{{{{}}}}}", key);

            let replacement = match value {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::Bool(b) => b.to_string(),
                serde_json::Value::Null => String::new(),
                _ => {
                    return Err(anyhow!("Unsupported variable type for key '{}'", key));
                }
            };

            result = result.replace(&placeholder, &replacement);
        }

        if result.contains("{{") && result.contains("}}") {
            let start = result.find("{{").unwrap();
            let end = result[start..].find("}}").unwrap() + start + 2;
            let missing_var = &result[start..end];

            warn!(
                missing_variable = %missing_var,
                "Template contains unreplaced variable"
            );

            return Err(anyhow!("Missing variable in template: {}", missing_var));
        }

        Ok(result)
    }
}