// Loaded before e2ee.js: configures the shared web crypto bridge for the native
// app. The bearer token is empty at load time and injected from Rust by
// src/lib/e2ee.ts once auth is known (the object is read by reference).
window.ExtrovertE2EEConfig = {
  apiBase: "https://extrovert.redforged.eu",
  olmWasmUrl: "/olm.wasm",
  bearerToken: "",
};
