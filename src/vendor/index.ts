// Side-effect imports, in order: bridge config (window.ExtrovertE2EEConfig),
// Olm wasm wrapper, the web app's E2EE implementation, room E2EE glue. These
// are plain IIFEs that attach to window; synced from the server repo via
// `npm run sync:web-crypto` (single source of truth, never hand-edit).
import "./bridge-config.js";
import "./olm.js";
import "./e2ee.js";
import "./room-e2ee.js";
