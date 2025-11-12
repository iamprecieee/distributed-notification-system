use std::fmt::{Display, Formatter, Result};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NotificationStatus {
    Queued,
    Processing,
    Sent,
    Failed,
    Dlq,
}

#[derive(Debug, Clone, PartialEq)]
pub enum IdempotencyStatus {
    NotFound,
    Processing,
    Sent,
    Failed,
}

impl Display for NotificationStatus {
    fn fmt(&self, f: &mut Formatter<'_>) -> Result {
        match self {
            NotificationStatus::Queued => write!(f, "queued"),
            NotificationStatus::Processing => write!(f, "processing"),
            NotificationStatus::Sent => write!(f, "sent"),
            NotificationStatus::Failed => write!(f, "failed"),
            NotificationStatus::Dlq => write!(f, "dlq"),
        }
    }
}
