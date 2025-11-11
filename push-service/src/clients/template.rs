use std::{collections::HashMap, time::Duration};

use anyhow::{Error, Result, anyhow};
use reqwest::Client;

use crate::{
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
}

impl TemplateServiceClient {
    pub async fn new(config: &Config) -> Result<Self, Error> {
        let http_client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| anyhow!("Failed to create HTTP client"))?;

        Ok(Self {
            http_client,
            base_url: config.template_service_url.clone(),
            retry_config: RetryConfig::from_config(config),
        })
    }

    pub async fn fetch_template(
        &self,
        template_code: &str,
        language: Option<&str>,
    ) -> Result<Template, Error> {
        let language = language.unwrap_or("en");
        let url = format!(
            "{}/api/v1/templates/{}?lang={}",
            self.base_url, template_code, language
        );

        retry_with_backoff(&self.retry_config, || {
            let url_clone = url.clone();
            let client = self.http_client.clone();

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

            return Err(anyhow!("Missing variable in template: {}", missing_var));
        }

        Ok(result)
    }
}
