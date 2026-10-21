FROM oven/bun:1.4.3 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build

FROM oven/bun:1.4.3 AS runtime
WORKDIR /app
ARG JOINLET_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/MarcoPeixot/joinlet"
LABEL org.opencontainers.image.revision="${JOINLET_REVISION}"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production
ENV PORT=8788
ENV STRUKT_REMOTE_DB=/data/remote.sqlite
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/LICENSE /app/THIRD_PARTY_NOTICES.md /app/TRADEMARKS.md /app/SOURCE.md ./
COPY --from=build /app/docs/third-party ./docs/third-party
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/mcp ./apps/mcp
COPY --from=build /app/apps/server/src ./apps/server/src
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/remote ./apps/remote
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD bun -e 'fetch(`http://127.0.0.1:${process.env.PORT || 8788}/ready`).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
CMD ["bun", "apps/remote/src/main.ts"]
