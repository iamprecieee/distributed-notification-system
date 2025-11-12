use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub id: String,
    pub code: String,

    #[serde(rename = "type")]
    pub template_type: String,

    pub language: String,
    pub version: i32,
    pub content: TemplateContent,
    pub variables: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateContent {
    pub title: String,
    pub body: String,
}
