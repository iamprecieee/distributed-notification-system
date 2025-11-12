$baseUrl = "http://localhost:8084"

Write-Host "=== Template Service Cache Test ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "Step 1: Create a template (cache will be set)" -ForegroundColor Yellow
$body1 = @{
    code = "cache_test"
    type = "push"
    language = "en"
    content = @{
        title = "Test {{name}}"
        body = "Hello {{name}}"
    }
    variables = @("name")
} | ConvertTo-Json

Invoke-RestMethod -Uri "$baseUrl/api/v1/templates" -Method Post -Body $body1 -ContentType "application/json"

Write-Host "`n"
Write-Host "Step 2: First GET (expect CACHE_MISS)" -ForegroundColor Yellow
Invoke-RestMethod -Uri "$baseUrl/api/v1/templates/cache_test?lang=en"

Write-Host "`n"
Write-Host "Step 3: Second GET (expect CACHE_HIT)" -ForegroundColor Yellow
Invoke-RestMethod -Uri "$baseUrl/api/v1/templates/cache_test?lang=en"

Write-Host "`n"
Write-Host "Step 4: Third GET (expect CACHE_HIT)" -ForegroundColor Yellow
Invoke-RestMethod -Uri "$baseUrl/api/v1/templates/cache_test?lang=en"

Write-Host "`n"
Write-Host "Step 5: Update template (cache will be invalidated)" -ForegroundColor Yellow
$body2 = @{
    language = "en"
    content = @{
        title = "Updated {{name}}"
        body = "Hi {{name}}"
    }
} | ConvertTo-Json

Invoke-RestMethod -Uri "$baseUrl/api/v1/templates/cache_test" -Method Put -Body $body2 -ContentType "application/json"

Write-Host "`n"
Write-Host "Step 6: GET after update (expect CACHE_MISS for new version)" -ForegroundColor Yellow
Invoke-RestMethod -Uri "$baseUrl/api/v1/templates/cache_test?lang=en"

Write-Host "`n"
Write-Host "Step 7: Second GET after update (expect CACHE_HIT)" -ForegroundColor Yellow
Invoke-RestMethod -Uri "$baseUrl/api/v1/templates/cache_test?lang=en"

Write-Host "`n=== Test Complete ===" -ForegroundColor Cyan
Write-Host "Check Docker logs: docker-compose logs -f template-service" -ForegroundColor Green
