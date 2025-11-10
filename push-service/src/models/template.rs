use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub language: String,
    pub subject: Option<String>,
    pub body_html: String,
    pub body_text: String,
    pub variables: Vec<String>,
}