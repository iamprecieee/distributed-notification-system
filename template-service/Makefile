.PHONY: help up down restart logs logs-all build clean status health test-cache test-breaker install

help: 
	@echo "Template Service - Available Commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

up: 
	docker-compose up --build -d

down: 
	docker-compose down

restart: 
	docker-compose restart

logs: 
	docker-compose logs -f template-service

logs-all: 
	docker-compose logs -f

build: 
	docker-compose build

clean: 
	docker-compose down -v

status: 
	docker-compose ps

health: 
	@curl -s http://localhost:8084/health | jq '.' || echo "Service not ready or jq not installed"

test-cache: 
	@powershell -ExecutionPolicy Bypass -File test-cache.ps1

test-breaker: 
	@powershell -ExecutionPolicy Bypass -File test-circuit-breaker.ps1

install: 
	npm install

migrate: 
	npm run migration:run

dev: 
	npm run start:dev

swagger: 
	@start http://localhost:8084/api/docs

rabbitmq: 
	@start http://localhost:15673