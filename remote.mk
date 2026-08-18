# Remote Dexter on the same host as nofx, as a separate tmux CLI service.
# SSH key/host defaults match nofx/remote.mk. Secrets stay in the remote .env.

REMOTE_HOST ?= 45.76.149.53
REMOTE_USER ?= root
REMOTE_PORT ?= 22
REMOTE_KEY ?= $(HOME)/.ssh/nofx
REMOTE_PROJECT_DIR ?= /root/Project/dexter
REMOTE_ENV_FILE ?= $(REMOTE_PROJECT_DIR)/.env
REMOTE_GIT_URL ?=

TMP_ENV_DIR ?= .tmp-remote-env
LOCAL_REMOTE_ENV ?= $(TMP_ENV_DIR)/.env

REMOTE_EXPORT = REMOTE_HOST="$(REMOTE_HOST)" REMOTE_USER="$(REMOTE_USER)" REMOTE_PORT="$(REMOTE_PORT)" \
	REMOTE_KEY="$(REMOTE_KEY)" REMOTE_PROJECT_DIR="$(REMOTE_PROJECT_DIR)" REMOTE_ENV_FILE="$(REMOTE_ENV_FILE)"

.PHONY: remote-cli remote-cli-new remote-cli-list remote-cli-attach remote-cli-kill remote-status remote-sync remote-pull-env remote-push-env

remote-cli:
	@$(REMOTE_EXPORT) bash scripts/remote-cli.sh attach

remote-cli-new:
	@$(REMOTE_EXPORT) bash scripts/remote-cli.sh new

remote-cli-list:
	@$(REMOTE_EXPORT) bash scripts/remote-cli.sh list

remote-cli-attach:
	@$(REMOTE_EXPORT) bash scripts/remote-cli.sh attach "$(SESSION)"

remote-cli-kill:
	@$(REMOTE_EXPORT) bash scripts/remote-cli.sh kill "$(SESSION)"

remote-status:
	@$(REMOTE_EXPORT) bash scripts/remote-cli.sh status

remote-sync:
	@$(REMOTE_EXPORT) REMOTE_GIT_URL="$(REMOTE_GIT_URL)" bash scripts/remote-sync.sh

remote-pull-env:
	@mkdir -p $(TMP_ENV_DIR)
	@echo "📥 Pulling remote $(REMOTE_USER)@$(REMOTE_HOST):$(REMOTE_ENV_FILE)"
	@scp -i $(REMOTE_KEY) -P $(REMOTE_PORT) -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o TCPKeepAlive=yes -o IdentitiesOnly=yes \
		$(REMOTE_USER)@$(REMOTE_HOST):$(REMOTE_ENV_FILE) $(LOCAL_REMOTE_ENV)
	@echo "✅ Saved to $(LOCAL_REMOTE_ENV)"

remote-push-env:
	@if [ ! -f $(LOCAL_REMOTE_ENV) ]; then \
		echo "❌ Missing $(LOCAL_REMOTE_ENV). Run make remote-pull-env or copy env.example there first."; \
		exit 1; \
	fi
	@echo "📤 Pushing $(LOCAL_REMOTE_ENV) to $(REMOTE_USER)@$(REMOTE_HOST):$(REMOTE_ENV_FILE)"
	@scp -i $(REMOTE_KEY) -P $(REMOTE_PORT) -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o TCPKeepAlive=yes -o IdentitiesOnly=yes \
		$(LOCAL_REMOTE_ENV) $(REMOTE_USER)@$(REMOTE_HOST):$(REMOTE_ENV_FILE)
	@echo "✅ Remote .env updated (running sessions keep their current env until restarted)"
