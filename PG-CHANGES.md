# Modifications to OpenReplay v1.28.0

This repository is a modified version of [OpenReplay](https://github.com/openreplay/openreplay) v1.28.0, published to comply with the GNU Affero General Public License v3 (see `LICENSE`, section 13).
Original copyright notices and license files are kept unchanged. Every modified line is marked in the source with `add lee <date>` / `modify lee <date>` ... `end` comments.

## Modified files

| Date | Files | Change |
|---|---|---|
| 2026-10-28 | `player/src/web/MessageManager.ts`, `player/src/web/TabManager.ts`, `player/src/web/WebLivePlayer.ts`, `player/src/web/assist/AssistManager.ts`, `player/src/web/assist/RemoteControl.ts`, `player/src/web/managers/DOM/DOMManager.ts`, `player/src/web/managers/DOM/VirtualDOM.ts`, `player/src/web/managers/PagesManager.ts` | Remote control: when the agent clicks an input, also send `focus` by node id (fixes wrong target when layouts differ); values changed by the visitor are shown while the agent's caret is in the field (deferred only while the agent is typing) |
| 2026-11-07 | `assist/utils/wsServer.js`, `assist/package.json`, `assist/package-lock.json` | Optional multi-instance support: when `PG_ASSIST_REDIS_URL` is set, attach the socket.io Redis adapter (`@socket.io/redis-adapter`, `redis`; pub/sub only, channel prefix `PG_ASSIST_REDIS_KEY`). Without it, behaviour is identical to upstream |
| 2026-11-08 | `frontend/env.ts`, `frontend/app/pgSource.ts`, `frontend/app/components/shared/Copyright.tsx` | "Source code (AGPL-3.0)" link in the login page footer; URL can be overridden at build time with `PG_SOURCE_URL` |
| 2026-11-09 | `player/src/web/assist/AssistManager.ts` | Remote control: the agent page no longer closes its connection after being hidden for 30 seconds (control used to be lost when the agent switched tabs); when the page becomes visible again it reconnects only if the connection was lost |
| 2026-10-29 – 2026-11-08 | `pg-image/Dockerfile.frontend` | Image recipe for the modified agent web UI (see `BUILD.md`) |

All other files in this repository are identical to upstream `v1.28.0`.
