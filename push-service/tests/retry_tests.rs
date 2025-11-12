use anyhow::{Result, anyhow};
use push_service::{models::retry::RetryConfig, utils::retry_with_backoff};
use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};
use tokio::time::Instant;

/// Test: Successful operations complete without retry
#[tokio::test]
async fn test_successful_operation_no_retry() -> Result<()> {
    let config = RetryConfig {
        max_attempts: 3,
        initial_delay_ms: 100,
        max_delay_ms: 1000,
        backoff_multiplier: 2,
    };

    let attempt_count = Arc::new(AtomicU32::new(0));
    let counter = Arc::clone(&attempt_count);

    let result = retry_with_backoff(&config, || {
        let counter = Arc::clone(&counter);
        async move {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok::<_, anyhow::Error>("success")
        }
    })
    .await?;

    assert_eq!(result, "success");
    assert_eq!(
        attempt_count.load(Ordering::SeqCst),
        1,
        "Should only attempt once"
    );

    Ok(())
}

/// Test: Transient failures are retried with backoff
#[tokio::test]
async fn test_transient_failures_are_retried() -> Result<()> {
    let config = RetryConfig {
        max_attempts: 5,
        initial_delay_ms: 100,
        max_delay_ms: 1000,
        backoff_multiplier: 2,
    };

    let attempt_count = Arc::new(AtomicU32::new(0));
    let counter = Arc::clone(&attempt_count);

    let result = retry_with_backoff(&config, || {
        let counter = Arc::clone(&counter);
        async move {
            let attempts = counter.fetch_add(1, Ordering::SeqCst);

            // Fail first 2 attempts, succeed on 3rd
            if attempts < 2 {
                Err(anyhow!("Transient error"))
            } else {
                Ok("success")
            }
        }
    })
    .await?;

    assert_eq!(result, "success");
    assert_eq!(
        attempt_count.load(Ordering::SeqCst),
        3,
        "Should retry 2 times then succeed"
    );

    Ok(())
}

/// Test: Permanent failures exhaust retries
#[tokio::test]
async fn test_permanent_failure_exhausts_retries() -> Result<()> {
    let config = RetryConfig {
        max_attempts: 4,
        initial_delay_ms: 50,
        max_delay_ms: 500,
        backoff_multiplier: 2,
    };

    let attempt_count = Arc::new(AtomicU32::new(0));
    let counter = Arc::clone(&attempt_count);

    let result = retry_with_backoff(&config, || {
        let counter = Arc::clone(&counter);
        async move {
            counter.fetch_add(1, Ordering::SeqCst);
            Err::<String, _>(anyhow!("Permanent failure"))
        }
    })
    .await;

    assert!(result.is_err(), "Should fail after max attempts");
    assert_eq!(
        attempt_count.load(Ordering::SeqCst),
        4,
        "Should attempt exactly max_attempts times"
    );

    Ok(())
}

/// Test: Retry delays follow exponential backoff
#[tokio::test]
async fn test_exponential_backoff_timing() -> Result<()> {
    let config = RetryConfig {
        max_attempts: 4,
        initial_delay_ms: 100,
        max_delay_ms: 1000,
        backoff_multiplier: 2,
    };

    let start = Instant::now();
    let attempt_times = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let times = Arc::clone(&attempt_times);

    let _ = retry_with_backoff(&config, || {
        let times = Arc::clone(&times);
        async move {
            let elapsed = start.elapsed().as_millis();
            times.lock().await.push(elapsed);
            Err::<String, _>(anyhow!("Fail"))
        }
    })
    .await;

    let times = attempt_times.lock().await;

    assert_eq!(times.len(), 4);

    assert!(times[0] < 50, "First attempt should be immediate");

    for i in 1..times.len() {
        let delay = times[i] - times[i - 1];
        let expected_min =
            (config.initial_delay_ms * config.backoff_multiplier.pow(i as u32 - 1)) * 8 / 10;
        let expected_max =
            (config.initial_delay_ms * config.backoff_multiplier.pow(i as u32 - 1)) * 12 / 10;

        assert!(
            delay >= expected_min as u128 && delay <= expected_max as u128,
            "Delay {} should be between {} and {} (actual: {})",
            i,
            expected_min,
            expected_max,
            delay
        );
    }

    Ok(())
}

/// Test: Max delay cap is respected
#[tokio::test]
async fn test_max_delay_cap_respected() -> Result<()> {
    let config = RetryConfig {
        max_attempts: 6,
        initial_delay_ms: 100,
        max_delay_ms: 300,
        backoff_multiplier: 2,
    };

    let start = Instant::now();
    let attempt_times = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let times = Arc::clone(&attempt_times);

    let _ = retry_with_backoff(&config, || {
        let times = Arc::clone(&times);
        async move {
            let elapsed = start.elapsed().as_millis();
            times.lock().await.push(elapsed);
            Err::<String, _>(anyhow!("Fail"))
        }
    })
    .await;

    let times = attempt_times.lock().await;

    for i in 3..times.len() {
        let delay = times[i] - times[i - 1];
        assert!(
            delay <= (config.max_delay_ms * 12 / 10) as u128,
            "Delay should not exceed max_delay_ms cap"
        );
    }

    Ok(())
}

/// Test: Jitter is applied to delays
#[tokio::test]
async fn test_jitter_applied_to_delays() -> Result<()> {
    let config = RetryConfig {
        max_attempts: 5,
        initial_delay_ms: 200,
        max_delay_ms: 2000,
        backoff_multiplier: 2,
    };

    let mut delays = Vec::new();

    for _ in 0..10 {
        let start = Instant::now();
        let attempt_times = Arc::new(tokio::sync::Mutex::new(Vec::new()));
        let times = Arc::clone(&attempt_times);

        let _ = retry_with_backoff(&config, || {
            let times = Arc::clone(&times);
            async move {
                let elapsed = start.elapsed().as_millis();
                times.lock().await.push(elapsed);
                Err::<String, _>(anyhow!("Fail"))
            }
        })
        .await;

        let times = attempt_times.lock().await;
        if times.len() >= 2 {
            delays.push(times[1] - times[0]);
        }
    }

    let min_delay = delays.iter().min().unwrap();
    let max_delay = delays.iter().max().unwrap();

    assert!(
        max_delay > min_delay,
        "Delays should vary due to jitter (min: {}, max: {})",
        min_delay,
        max_delay
    );

    Ok(())
}

/// Test: Retry behavior under concurrent operations
#[tokio::test]
async fn test_concurrent_retry_operations() -> Result<()> {
    let config = Arc::new(RetryConfig {
        max_attempts: 3,
        initial_delay_ms: 50,
        max_delay_ms: 500,
        backoff_multiplier: 2,
    });

    let total_success = Arc::new(AtomicU32::new(0));
    let mut handles = vec![];

    for i in 0..10 {
        let config = Arc::clone(&config);
        let success_counter = Arc::clone(&total_success);

        let handle = tokio::spawn(async move {
            let attempt_count = Arc::new(AtomicU32::new(0));
            let counter = Arc::clone(&attempt_count);

            let result = retry_with_backoff(&config, || {
                let counter = Arc::clone(&counter);
                async move {
                    let attempts = counter.fetch_add(1, Ordering::SeqCst);

                    if i < 5 && attempts == 0 {
                        Err(anyhow!("First attempt fails"))
                    } else {
                        Ok("success")
                    }
                }
            })
            .await;

            if result.is_ok() {
                success_counter.fetch_add(1, Ordering::SeqCst);
            }
        });

        handles.push(handle);
    }

    futures_util::future::join_all(handles).await;

    assert_eq!(
        total_success.load(Ordering::SeqCst),
        10,
        "All concurrent operations should eventually succeed"
    );

    Ok(())
}

/// Test: Retry state is independent per operation
#[tokio::test]
async fn test_retry_state_independence() -> Result<()> {
    let config = Arc::new(RetryConfig {
        max_attempts: 5,
        initial_delay_ms: 50,
        max_delay_ms: 500,
        backoff_multiplier: 2,
    });

    // Operation 1: Fails permanently
    let config1 = Arc::clone(&config);
    let handle1 = tokio::spawn(async move {
        retry_with_backoff(&config1, || async {
            Err::<String, _>(anyhow!("Always fail"))
        })
        .await
    });

    // Operation 2: Succeeds after 2 attempts
    let config2 = Arc::clone(&config);
    let counter2 = Arc::new(AtomicU32::new(0));
    let counter2_clone = Arc::clone(&counter2);
    let handle2 = tokio::spawn(async move {
        retry_with_backoff(&config2, || {
            let counter = Arc::clone(&counter2_clone);
            async move {
                let attempts = counter.fetch_add(1, Ordering::SeqCst);
                if attempts < 2 {
                    Err(anyhow!("Fail"))
                } else {
                    Ok("success")
                }
            }
        })
        .await
    });

    let (result1, result2) = tokio::join!(handle1, handle2);

    assert!(result1.unwrap().is_err(), "Operation 1 should fail");
    assert!(result2.unwrap().is_ok(), "Operation 2 should succeed");
    assert_eq!(
        counter2.load(Ordering::SeqCst),
        3,
        "Operation 2 should make 3 attempts"
    );

    Ok(())
}
