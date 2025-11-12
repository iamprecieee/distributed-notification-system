#!/bin/bash

echo "=== Template Service Cache Test ==="
echo ""

BASE_URL="http://localhost:8084"

echo "Step 1: Create a template (cache will be set)"
curl -X POST "$BASE_URL/api/v1/templates" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "cache_test",
    "type": "push",
    "language": "en",
    "content": {
      "title": "Test {{name}}",
      "body": "Hello {{name}}"
    },
    "variables": ["name"]
  }'

echo -e "\n\n"
echo "Step 2: First GET (expect CACHE_MISS)"
curl "$BASE_URL/api/v1/templates/cache_test?lang=en"

echo -e "\n\n"
echo "Step 3: Second GET (expect CACHE_HIT)"
curl "$BASE_URL/api/v1/templates/cache_test?lang=en"

echo -e "\n\n"
echo "Step 4: Third GET (expect CACHE_HIT)"
curl "$BASE_URL/api/v1/templates/cache_test?lang=en"

echo -e "\n\n"
echo "Step 5: Update template (cache will be invalidated)"
curl -X PUT "$BASE_URL/api/v1/templates/cache_test" \
  -H "Content-Type: application/json" \
  -d '{
    "language": "en",
    "content": {
      "title": "Updated {{name}}",
      "body": "Hi {{name}}"
    }
  }'

echo -e "\n\n"
echo "Step 6: GET after update (expect CACHE_MISS for new version)"
curl "$BASE_URL/api/v1/templates/cache_test?lang=en"

echo -e "\n\n"
echo "Step 7: Second GET after update (expect CACHE_HIT)"
curl "$BASE_URL/api/v1/templates/cache_test?lang=en"

echo -e "\n\n"
echo "=== Test Complete ==="
echo "Check Docker logs: docker-compose logs -f template-service"
