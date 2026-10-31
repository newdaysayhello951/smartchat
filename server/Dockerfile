FROM debian:bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends cmake g++ libboost-system-dev libssl-dev libmariadb-dev nlohmann-json3-dev pkg-config && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j2
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libboost-system1.74.0 libmariadb3 libssl3 ca-certificates && rm -rf /var/lib/apt/lists/* && useradd -u 10001 -m app && mkdir -p /data/files && chown app /data/files
COPY --from=build /src/build/im_server /usr/local/bin/im_server
USER app
CMD ["im_server"]
