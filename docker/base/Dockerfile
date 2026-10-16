# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22-bookworm-slim
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS source-pack

ARG GRAVITY_VERSION

ENV ONNXRUNTIME_NODE_INSTALL=skip

WORKDIR /tmp/gravity-src
COPY . .

RUN set -eux; \
    if [ -n "${GRAVITY_VERSION:-}" ]; then \
      test "$(node -p "require('./package.json').version")" = "${GRAVITY_VERSION}"; \
    fi; \
    node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'; \
    npm ci

RUN set -eux; \
    mkdir -p /tmp/gravity-packs; \
    npm pack --workspace=@gravity/highlight --pack-destination /tmp/gravity-packs; \
    npm pack --workspace=@gravity/relay --pack-destination /tmp/gravity-packs; \
    npm pack --workspace=@gravity/protocol --pack-destination /tmp/gravity-packs; \
    npm pack --workspace=@gravity/client --pack-destination /tmp/gravity-packs; \
    npm pack --workspace=@gravity/plugin --pack-destination /tmp/gravity-packs; \
    npm pack --workspace=@gravity/server --pack-destination /tmp/gravity-packs; \
    npm pack --workspace=@gravity/cli --pack-destination /tmp/gravity-packs

FROM ${NODE_IMAGE}

ENV HOME=/home/gravity \
    GRAVITY_HOME=/home/gravity/.gravity \
    GRAVITY_LISTEN=0.0.0.0:6767 \
    GRAVITY_WEB_UI_ENABLED=true \
    GRAVITY_LOG_FORMAT=json \
    GRAVITY_LOG_LEVEL=info \
    CLAUDE_CONFIG_DIR=/home/gravity/.claude \
    CODEX_HOME=/home/gravity/.codex \
    XDG_CONFIG_HOME=/home/gravity/.config \
    XDG_DATA_HOME=/home/gravity/.local/share \
    XDG_STATE_HOME=/home/gravity/.local/state \
    XDG_CACHE_HOME=/home/gravity/.cache \
    ONNXRUNTIME_NODE_INSTALL=skip

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      gosu \
      lbzip2 \
      openssh-client \
      procps \
      tini; \
    rm -rf /var/lib/apt/lists/*

COPY --from=source-pack /tmp/gravity-packs /tmp/gravity-packs
RUN set -eux; \
	npm install -g /tmp/gravity-packs/*.tgz; \
    rm -rf /tmp/gravity-packs; \
    npm cache clean --force; \
    server_entry="$(npm root -g)/@gravity/server/dist/scripts/supervisor-entrypoint.js"; \
    test -f "$server_entry"; \
    printf '%s\n' "$server_entry" > /etc/gravity-server-entry; \
    node --check "$server_entry"

RUN set -eux; \
    existing_group="$(getent group 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_group" ] && [ "$existing_group" != "gravity" ]; then \
      groupmod --new-name gravity "$existing_group"; \
    elif [ -z "$existing_group" ]; then \
      groupadd --gid 1000 gravity; \
    fi; \
    existing_user="$(getent passwd 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_user" ] && [ "$existing_user" != "gravity" ]; then \
      usermod --login gravity --gid gravity --home /home/gravity --shell /bin/bash "$existing_user"; \
    elif [ -z "$existing_user" ]; then \
      useradd --uid 1000 --gid gravity --create-home --home-dir /home/gravity --shell /bin/bash gravity; \
    fi; \
    mkdir -p \
      /workspace \
      "$GRAVITY_HOME" \
      "$CLAUDE_CONFIG_DIR" \
      "$CODEX_HOME" \
      "$XDG_CONFIG_HOME" \
      "$XDG_DATA_HOME" \
      "$XDG_STATE_HOME" \
      "$XDG_CACHE_HOME"; \
    chown -R gravity:gravity /home/gravity /workspace

COPY docker/base/rootfs/ /
RUN chmod +x /usr/local/bin/gravity-docker-entrypoint

WORKDIR /workspace

EXPOSE 6767
VOLUME ["/home/gravity"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const listen=process.env.GRAVITY_LISTEN||'0.0.0.0:6767'; const m=listen.match(/:(\\d+)$/); const port=m?Number(m[1]):6767; require('http').get({hostname:'127.0.0.1',port,path:'/api/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/gravity-docker-entrypoint"]
