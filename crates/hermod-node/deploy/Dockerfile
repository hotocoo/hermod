# Volunteer relay/bootstrap peer. Build from the repository root:
#   docker build -f crates/hermod-node/deploy/Dockerfile -t hermod-node .
FROM rust:1.90-slim AS build
WORKDIR /src
COPY . .
RUN cargo build --release -p hermod-node --bin hermod-node

FROM debian:bookworm-slim
RUN useradd --system --create-home --home-dir /data hermod
COPY --from=build /src/target/release/hermod-node /usr/local/bin/hermod-node
USER hermod
VOLUME /data
EXPOSE 4001/tcp 4001/udp
# Pass --external-addr /ip4/<public ip>/tcp/4001 (and /udp/4001/quic-v1) for a static address.
ENTRYPOINT ["hermod-node", "--data-dir", "/data"]
CMD ["--relay", "auto"]
