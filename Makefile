.PHONY: help setup test test-backend test-frontend lint dev build package clean

PYTHON ?= python3

help: ## Show what each command does
	@grep -E '^[a-z-]+:.*## ' Makefile | awk -F':.*## ' '{printf "  make %-14s %s\n", $$1, $$2}'

setup: ## Install everything needed to run and test CloudDrop locally
	@$(PYTHON) -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else "Python 3.11 or newer is needed. Try: make setup PYTHON=python3.13")'
	$(PYTHON) -m venv .venv
	.venv/bin/pip install -q -r backend/requirements-dev.txt
	npm --prefix frontend install

test: test-backend test-frontend lint ## Run every check

test-backend: ## Backend tests only
	cd backend && ../.venv/bin/pytest -q

test-frontend: ## Frontend tests only
	npm --prefix frontend test

lint: ## Check the CloudFormation template
	.venv/bin/cfn-lint infra/template.yaml

dev: ## Run the whole app on this computer (http://localhost:5173)
	./scripts/dev.sh

build: ## Build the site into frontend/dist
	npm --prefix frontend run build

package: ## Zip the committed source into clouddrop.zip (to share or submit)
	git archive --format=zip --prefix=clouddrop/ -o clouddrop.zip HEAD

clean: ## Remove everything "make setup" and the builds created
	rm -rf .venv frontend/node_modules frontend/dist .aws-sam backend/.pytest_cache
