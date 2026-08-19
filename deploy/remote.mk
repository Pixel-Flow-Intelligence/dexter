REMOTE_HOST ?= 45.76.149.53
REMOTE_USER ?= root
REMOTE_PORT ?= 22
REMOTE_KEY ?= ~/.ssh/nofx
REMOTE_PROJECT_DIR ?= /root/Project/dexter
REMOTE_SERVICE ?= dexter-grpc
REMOTE_HTTP_SERVICE ?= dexter-http
REMOTE_NGINX_SITE ?= dexter.moltbot.dpdns.org.conf
REMOTE_OLD_NGINX_SITE ?= dexter.aitrading.dpdns.org.conf
REMOTE_NGINX_AVAILABLE_DIR ?= /etc/nginx/sites-available
REMOTE_NGINX_ENABLED_DIR ?= /etc/nginx/sites-enabled
BUN_BIN ?= /root/.bun/bin/bun
SSH_OPTS := -i $(REMOTE_KEY) -p $(REMOTE_PORT) -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o TCPKeepAlive=yes -o IdentitiesOnly=yes
SCP_OPTS := -i $(REMOTE_KEY) -P $(REMOTE_PORT) -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o TCPKeepAlive=yes -o IdentitiesOnly=yes

.PHONY: remote-deploy remote-status remote-logs remote-stop remote-health

remote-deploy:
	@set -eu; \
	TMP=$$(mktemp -d); \
	tar --exclude=.git --exclude=node_modules --exclude=.env --exclude=.dexter --exclude=dist -czf "$$TMP/dexter.tar.gz" .; \
	scp $(SCP_OPTS) "$$TMP/dexter.tar.gz" $(REMOTE_USER)@$(REMOTE_HOST):/tmp/dexter.tar.gz; \
	ssh $(SSH_OPTS) $(REMOTE_USER)@$(REMOTE_HOST) 'set -eu; mkdir -p $(REMOTE_PROJECT_DIR); tar -xzf /tmp/dexter.tar.gz -C $(REMOTE_PROJECT_DIR); rm -f /tmp/dexter.tar.gz; cd $(REMOTE_PROJECT_DIR); touch .env; chmod 600 .env; if ! grep -q "^DEXTER_SERVICE_TOKEN=" .env; then printf "DEXTER_SERVICE_TOKEN=%s\\n" "$$(openssl rand -hex 32)" >> .env; fi; $(BUN_BIN) install --frozen-lockfile; install -m 0644 deploy/dexter.service /etc/systemd/system/$(REMOTE_SERVICE).service; install -m 0644 deploy/dexter-http.service /etc/systemd/system/$(REMOTE_HTTP_SERVICE).service; install -m 0644 deploy/nginx/$(REMOTE_NGINX_SITE) $(REMOTE_NGINX_AVAILABLE_DIR)/$(REMOTE_NGINX_SITE); ln -sfn $(REMOTE_NGINX_AVAILABLE_DIR)/$(REMOTE_NGINX_SITE) $(REMOTE_NGINX_ENABLED_DIR)/$(REMOTE_NGINX_SITE); rm -f $(REMOTE_NGINX_ENABLED_DIR)/$(REMOTE_OLD_NGINX_SITE) $(REMOTE_NGINX_AVAILABLE_DIR)/$(REMOTE_OLD_NGINX_SITE); nginx -t; systemctl daemon-reload; systemctl enable --now $(REMOTE_SERVICE) $(REMOTE_HTTP_SERVICE); systemctl restart $(REMOTE_SERVICE) $(REMOTE_HTTP_SERVICE); systemctl reload nginx; systemctl --no-pager --full status $(REMOTE_SERVICE) $(REMOTE_HTTP_SERVICE)'; \
	rm -rf "$$TMP"

remote-status:
	@ssh $(SSH_OPTS) $(REMOTE_USER)@$(REMOTE_HOST) 'systemctl --no-pager --full status $(REMOTE_SERVICE) $(REMOTE_HTTP_SERVICE); ss -lntp | grep -E ":(50071|8787) " || true; nginx -t'

remote-logs:
	@ssh $(SSH_OPTS) $(REMOTE_USER)@$(REMOTE_HOST) 'journalctl -u $(REMOTE_SERVICE) -n 120 --no-pager'

remote-stop:
	@ssh $(SSH_OPTS) $(REMOTE_USER)@$(REMOTE_HOST) 'systemctl disable --now $(REMOTE_SERVICE) $(REMOTE_HTTP_SERVICE) || true'

remote-health:
	@ssh $(SSH_OPTS) $(REMOTE_USER)@$(REMOTE_HOST) 'cd $(REMOTE_PROJECT_DIR) && timeout 10 $(BUN_BIN) run src/server/index.ts >/tmp/dexter-health.log 2>&1 & pid=$$!; sleep 2; ss -lntp | grep ":50071 "; kill $$pid 2>/dev/null || true; wait $$pid 2>/dev/null || true; tail -n 20 /tmp/dexter-health.log'
