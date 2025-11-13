use anyhow::{Result, anyhow};

pub fn validate_fcm_token(token: &str) -> Result<()> {
    if token.is_empty() {
        return Err(anyhow!("Device token cannot be empty"));
    }

    if token.len() < 20 {
        return Err(anyhow!("Device token too short (minimum 20 characters)"));
    }

    if token.len() > 200 {
        return Err(anyhow!("Device token too long (maximum 200 characters)"));
    }

    let valid_chars = token
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == ':' || c == '.');

    if !valid_chars {
        return Err(anyhow!("Device token contains invalid characters"));
    }

    Ok(())
}
