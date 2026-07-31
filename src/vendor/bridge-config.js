// Loaded before e2ee.js: configures the shared web crypto bridge for the native
// app. The bearer token is empty at load time and injected from Rust by
// src/lib/e2ee.ts once auth is known (the object is read by reference).
//
// OLM_OPTIONS: the emscripten bundle assigns `OLM_OPTIONS = opts` at init time
// (an implicit global in sloppy mode). Vite bundles it as a strict ES module,
// where assigning to an undeclared identifier throws. Pre-declaring the global
// here keeps that assignment legal.
window.OLM_OPTIONS = window.OLM_OPTIONS || {};
window.ExtrovertE2EEConfig = {
  apiBase: "https://extrovert.redforged.eu",
  olmWasmUrl: "/olm.wasm",
  bearerToken: "",
};
