use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationMessage {
    pub trace_id: String,
    pub idempotency_key: String,
    pub user_id: String,
    pub notification_type: String,
    pub recipient: String,
    pub template_code: String,
    pub variables: HashMap<String, serde_json::Value>,

    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DlqMessage {
    pub original_message: NotificationMessage,
    pub failure_reason: String,
    pub failed_at: String,
}
