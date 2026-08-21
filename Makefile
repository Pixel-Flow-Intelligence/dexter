include remote.mk

# Deploy / ops targets live in deploy/remote.mk (e.g. remote-deploy).
.PHONY: remote-providers-status providers-status

remote-providers-status:
	@"$(MAKE)" -f deploy/remote.mk remote-providers-status PROVIDERS="$(PROVIDERS)"

# Local check against a running dexter-http (default 127.0.0.1:8787).
# Reads DEXTER_SERVICE_TOKEN from .env when not already exported.
providers-status:
	@set -eu; \
	TOKEN="$${DEXTER_SERVICE_TOKEN:-}"; \
	if [ -z "$$TOKEN" ] && [ -f .env ]; then \
		TOKEN=$$(grep -E "^DEXTER_SERVICE_TOKEN=" .env | head -n1 | cut -d= -f2- | tr -d "\"'"); \
	fi; \
	if [ -z "$$TOKEN" ]; then echo "DEXTER_SERVICE_TOKEN not set (export it or put it in .env)" >&2; exit 1; fi; \
	URL="$${DEXTER_HTTP_URL:-http://127.0.0.1:8787}/v1/providers/status"; \
	if [ -n "$(PROVIDERS)" ]; then URL="$$URL?providers=$(PROVIDERS)"; fi; \
	echo "GET $$URL"; \
	BODY=$$(curl -sS --max-time 120 -H "Authorization: Bearer $$TOKEN" -H "Accept: application/json" "$$URL"); \
	if command -v python3 >/dev/null 2>&1; then printf "%s\n" "$$BODY" | python3 -m json.tool; \
	elif command -v jq >/dev/null 2>&1; then printf "%s\n" "$$BODY" | jq .; \
	else printf "%s\n" "$$BODY"; fi
