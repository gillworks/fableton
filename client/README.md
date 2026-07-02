# @fableton/client

Three.js browser client (React Three Fiber to start). One codebase, three camera modes: **explore** (drag/zoom/orbit — the public default), **walk** (later), **director** (cinematic auto-cam used headless by the streamer).

Consumes: chunk JSON (static geometry) + the `world-sim` WebSocket (dynamic state, interpolated client-side). v1 scope: chunk streaming, explore camera, click-to-inspect panel. See [docs/architecture.md § The explore surface](../docs/architecture.md).
