# Multi-stage: build the React app, then serve it with nginx.
# Self-hosters never need Node locally — `docker compose up` builds everything.
#
# --platform=$BUILDPLATFORM pins the build stage to the host's native arch even when
# cross-building for other targets (e.g. amd64 host building an arm64 image). The build
# output (static JS/CSS/HTML) is arch-independent, so there's no reason to run it under
# QEMU — and QEMU-emulated npm installs are known to corrupt esbuild/rollup's platform-
# specific native binaries, which is what breaks `vite build` with unrelated-looking
# module-resolution errors.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
ARG VITE_EXERCISE_MEDIA=disabled
ARG VITE_SOURCE_URL=https://github.com/TesseractPrints/opengym
ENV VITE_EXERCISE_MEDIA=$VITE_EXERCISE_MEDIA
ENV VITE_SOURCE_URL=$VITE_SOURCE_URL
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
