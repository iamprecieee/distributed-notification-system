use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,

    pub message: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<PaginationMeta>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PaginationMeta {
    pub total: u64,
    pub limit: u64,
    pub page: u64,
    pub total_pages: u64,
    pub has_next: bool,
    pub has_previous: bool,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T, message: String) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
            message,
            meta: None,
        }
    }

    pub fn error(error: String, message: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
            message,
            meta: None,
        }
    }
}
