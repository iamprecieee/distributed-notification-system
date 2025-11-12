use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FcmRequest {
    pub message: FcmMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FcmMessage {
    pub token: String,
    pub notification: FcmNotification,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FcmNotification {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FcmResponse {
    pub name: Option<String>,
}
