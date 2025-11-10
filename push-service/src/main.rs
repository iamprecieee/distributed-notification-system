use anyhow::{Error, Result};
use push_service::config::Config;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let _ = Config::load()?;

    println!("Configuration validated. Worker is ready to start.");

    Ok(())
}
