# Browser Platform

> Status: accepted

## Delivery target

Ship a static browser application. The production bundle must resolve Worker, WASM, and snapshot assets under both root and non-root base URLs without development filesystem assumptions.

## Browser support

Target current desktop Chrome, Firefox, and Safari. Chromium is the primary development/smoke-test browser; add Firefox and WebKit coverage after Chromium is stable. Mobile-first polish is outside the MVP.

## WASM constraints

Use the single-threaded synchronous WASM build inside a dedicated Worker. The MVP does not require `SharedArrayBuffer`, cross-origin isolation, or WebAssembly JSPI/stack switching.

## Resilience checks

Verify refresh during loading and after completion, missing-image fallback, Worker timeout/termination, keyboard-only prompt completion, and hidden-information safety through main-thread message inspection.
