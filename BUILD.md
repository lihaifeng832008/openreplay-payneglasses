# Building the modified components

Only two OpenReplay components are modified and deployed; all other services run the official v1.28.0 images.

## Agent web UI (frontend + player)

```bash
cd player   && npx yarn@1.22.22 install --frozen-lockfile
cd ../frontend && cp .env.sample .env && corepack yarn install --immutable
NODE_OPTIONS=--max-old-space-size=8192 corepack yarn build   # output: frontend/public
```

The image is built with `pg-image/Dockerfile.frontend`: the official `frontend:v1.28.0` image with `/var/www/openreplay/` replaced by `frontend/public/`.
(The Dockerfile also copies a separately built, MIT-licensed tracker bundle into `/pg/`; it is not part of the AGPL work and is not required to run the UI.)

## Assist service

```bash
docker build -f assist/Dockerfile assist
```

Optional environment variables: `PG_ASSIST_REDIS_URL` (enables the Redis adapter), `PG_ASSIST_REDIS_KEY` (channel prefix, default `pg-or-assist`).

## Version

The running version corresponds to the latest tag of this repository (format `v1.28.0-pgN`).
