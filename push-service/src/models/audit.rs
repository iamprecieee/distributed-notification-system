use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::models::status::NotificationStatus;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLog {
    pub id: Uuid,
    pub trace_id: String,
    pub user_id: Uuid,
    pub notification_type: String,
    pub template_code: String,
    pub status: NotificationStatus,
    pub error_message: Option<String>,
    pub metadata: JsonValue,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreateAuditLog {
    pub trace_id: String,
    pub user_id: String,
    pub notification_type: String,
    pub template_code: String,
    pub status: NotificationStatus,
    pub error_message: Option<String>,
    pub metadata: JsonValue,
}

impl CreateAuditLog {
    pub fn new(
        trace_id: String,
        user_id: String,
        notification_type: String,
        template_code: String,
        status: NotificationStatus,
    ) -> Self {
        Self {
            trace_id,
            user_id,
            notification_type,
            template_code,
            status,
            error_message: None,
            metadata: serde_json::json!({}),
        }
    }

    pub fn with_error(mut self, error: String) -> Self {
        self.error_message = Some(error);
        self
    }

    pub fn with_metadata(mut self, metadata: JsonValue) -> Self {
        self.metadata = metadata;
        self
    }
}
