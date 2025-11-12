$baseUrl = "http://localhost:8084"

Write-Host "=== Circuit Breaker Test ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "Step 1: Initial health check (all services healthy)" -ForegroundColor Yellow
Invoke-RestMethod -Uri "$baseUrl/health" | ConvertTo-Json -Depth 5

Write-Host "`n`nStep 2: Stop Postgres container" -ForegroundColor Yellow
docker-compose stop postgres

Start-Sleep -Seconds 2

Write-Host "`n`nStep 3: Health check #1 (DB should start failing)" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/health" | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

Start-Sleep -Seconds 2

Write-Host "`n`nStep 4: Health check #2-5 (triggering circuit breaker)" -ForegroundColor Yellow
for ($i = 2; $i -le 5; $i++) {
    Write-Host "`nAttempt $i..." -ForegroundColor Gray
    try {
        Invoke-RestMethod -Uri "$baseUrl/health" | ConvertTo-Json -Depth 5
    } catch {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
    Start-Sleep -Seconds 1
}

Write-Host "`n`nStep 5: Health check after circuit opened" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/health" | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n`nStep 6: Restart Postgres" -ForegroundColor Yellow
docker-compose start postgres

Start-Sleep -Seconds 5

Write-Host "`n`nStep 7: Wait 30s for circuit breaker timeout..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

Write-Host "`n`nStep 8: Health check after timeout (should half-open)" -ForegroundColor Yellow
Invoke-RestMethod -Uri "$baseUrl/health" | ConvertTo-Json -Depth 5

Write-Host "`n`nStep 9: Health check (should close circuit)" -ForegroundColor Yellow
Invoke-RestMethod -Uri "$baseUrl/health" | ConvertTo-Json -Depth 5

Write-Host "`n`n=== Test Complete ===" -ForegroundColor Cyan
Write-Host "Circuit breaker should be CLOSED now" -ForegroundColor Green
