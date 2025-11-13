use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationMessage {
    pub notification_id: String,
    pub idempotency_key: String,
    pub notification_type: String,
    pub user_id: String,
    pub template_code: String,
    pub variables: HashMap<String, serde_json::Value>,
    pub request_id: String,
    pub priority: i32,
    pub metadata: HashMap<String, serde_json::Value>,
    pub created_by: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DlqMessage {
    pub original_message: NotificationMessage,
    pub failure_reason: String,
    pub failed_at: String,
}

#[derive(Debug, Deserialize)]
pub struct Envelope {
    pub pattern: String,
    pub data: NotificationMessage,
}