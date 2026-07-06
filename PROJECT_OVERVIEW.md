# Unlimit POS — Kiosk AIOS

A self-service **Android POS kiosk application** built for the **Zebra KC50** (1080 × 1920 portrait, Android 13), enabling customers to browse a product catalog, build a cart, check out, and pay contactlessly via **Softpay Tap-to-Pay (AppSwitch)** — all with an offline-first order pipeline so the customer never waits on the network.

> **AI-accelerated development:** Architected, built, and hardware-verified by the engineering team, with **[Claude Code](https://claude.com/claude-code)** (Anthropic's AI coding agent) used as an AI pair-programming tool to accelerate implementation, debugging, and documentation. All architecture decisions, payment-flow design, and on-device verification (Softpay AppSwitch, USB HID scanners, kiosk hardware) were engineer-led.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Key Features](#key-features)
- [Payments — Softpay AppSwitch](#payments--softpay-appswitch)
- [Offline-First Design](#offline-first-design)
- [Hardware Target](#hardware-target)
- [Project Structure](#project-structure)
- [Build & Verify](#build--verify)
- [Configuration](#configuration)
- [Documentation](#documentation)

---

## Tech Stack

### Language & Build

| Technology | Version | Purpose |
|---|---|---|
| Kotlin | 2.1.10 (AGP-bundled) | Primary language |
| Android Gradle Plugin | 9.1.1 | Build system (built-in Kotlin — no external `kotlin-android` plugin) |
| KSP | 2.1.10-1.0.31 | Annotation processing (Hilt, Room, Moshi codegen) |
| Java compatibility | 11 | `sourceCompatibility` / `targetCompatibility` |
| Min / Target SDK | 24 / 36 | Android 7.0+ through Android 16 |

### Core Frameworks & Libraries

| Category | Library | Version |
|---|---|---|
| Dependency Injection | Dagger Hilt (+ `androidx.hilt:hilt-work`) | 2.59.2 / 1.2.0 |
| Local Database | Room (runtime, KTX, compiler) | 2.7.0 |
| Networking | Retrofit + Moshi converter | 2.11.0 |
| HTTP Client | OkHttp + logging interceptor | 4.12.0 |
| JSON | Moshi + Kotlin codegen | 1.15.1 |
| Realtime | Socket.IO client (`io.socket:socket.io-client`) | 2.1.2 |
| Background Work | WorkManager (`work-runtime-ktx`) | 2.10.0 |
| Payments | Softpay AppSwitch SDK (`io.softpay:softpay-client`) | 1.8.0 |
| Async | Kotlinx Coroutines (StateFlow / SharedFlow) | 1.9.0 |
| Navigation | AndroidX Navigation (fragment + UI KTX) | 2.8.5 |
| Lifecycle | ViewModel, Runtime, SavedState KTX | 2.8.7 |
| Image Loading | Coil + Coil-GIF | 2.7.0 |
| UI Toolkit | Material Components, ConstraintLayout, RecyclerView | 1.13.0 / 2.2.1 / 1.4.0 |
| Loading UX | Facebook Shimmer | 0.5.0 |
| Scalable dimens | Intuit SDP / SSP | 1.1.1 |
| Network Debugging | Chucker (debug builds; no-op in release) | 4.0.0 |

### UI Approach

- **XML layouts + ViewBinding** (no Jetpack Compose, no DataBinding)
- **MVVM** with `StateFlow` for state and `SharedFlow` for one-shot events
- Fragments + a single-activity Navigation graph
- Three-tier responsive dimension system: `values/` (baseline) → `values-sw720dp/` (10" tablets) → `values-sw900dp/` (kiosk, Figma 1:1 source of truth)
- Custom typography stack (Avant Garde Pro, DM Sans, Inter) via a `TextAppearance.Pos.*` hierarchy and semantic color tokens

### Testing

- JUnit 4 + `kotlinx-coroutines-test` (JVM unit tests)
- AndroidX Test (JUnit ext, Espresso), Room Testing, WorkManager Testing (instrumented)

---

## Architecture

**Clean Architecture** with three layers, wired by Hilt:

```
ui/        MVVM — Fragments + ViewBinding, ViewModels (StateFlow/SharedFlow),
           shared UiText/error rendering, reusable view extensions
domain/    Entities, use cases, typed Result<D, E> / DataError,
           provider interfaces (PaymentProcessor, ScannerProvider)
data/      Room DAOs/entities, Retrofit API + DTOs + mappers, repositories,
           WorkManager sync, Socket.IO realtime handler, auth preferences
```

Key patterns:

- **Typed errors** — repositories return `Result<T, DataError.Network>` via `safeApiCall` / `safeEnvelopeCall`; errors surface to UI as translated `UiText`, never raw exception messages.
- **Provider abstraction for hardware SDKs** — `PaymentProcessor` and `ScannerProvider` are domain interfaces; implementations (Softpay SDK, simulated payments, USB HID scanner) swap with a single Hilt binding.
- **Activity-scoped `PosViewModel`** as the single source of truth across the cart → checkout → payment → success flow.
- **API-driven localisation** — translations fetched from the backend and held in a shared language ViewModel; static `strings.xml` carries only non-translatable branding.

---

## Key Features

- **Product catalog** with category sidebar, realtime push updates (Socket.IO `catalog.*` events), shimmer loading states, and animated content arrival
- **Cart** with per-line quantity controls, stock-limit gating, badge animations, and a payment-in-progress cart lock that prevents duplicate orders
- **Barcode scanning** via a transport-agnostic HID keystroke provider (works with Datalogic USB scanners today, Zebra DataWedge keystroke mode on the KC50)
- **Offline-first checkout** — orders persist to Room and upload via WorkManager with exponential backoff; payment happens after the order is safely stored
- **Tap-to-Pay** through Softpay AppSwitch with webhook-driven backend confirmation (socket-event vs. receipt-poll race)
- **Resume-payment guard** — backing out of payment never creates a duplicate order; the flow resumes the existing one
- **Device authentication** — auto-login with JWT bearer token, provisioned per device
- **Dynamic localisation** with a language picker on every screen
- **Kiosk hardening** — lock-task mode declarations, Zebra EHS metadata, IME suppression handling for attached HID hardware

---

## Payments — Softpay AppSwitch

The payment flow runs in three phases inside `TapToPayFragment`:

1. **Phase A** — await the server-assigned `merchantReference` (from the order upload) before starting payment
2. **Phase B** — hand off to the Softpay app via AppSwitch (`PaymentTransaction.call`); the Softpay result screen auto-dismisses via `switchBackTimeout` (1.5 s)
3. **Phase C** — await *backend* confirmation: a race between the Socket.IO `payment.success`/`payment.failed` event and a poll of `GET /orders/{id}/receipt`, because the kiosk's socket reliably drops while Softpay is foregrounded

The backend's webhook (fed by Softpay's cloud) is the canonical source of payment truth — the kiosk never trusts the SDK result alone. Order lifecycle (Room persistence, upload) is fully decoupled from payment lifecycle (`PENDING_PAYMENT` → `PAID` / `PAYMENT_FAILED` / `PAYMENT_CANCELLED`).

Softpay is an operator opt-in (`local.properties: use.softpay=true`); default builds use a simulated processor so the project builds without sandbox credentials.

---

## Offline-First Design

- `CheckoutUseCase` writes the order to Room **before** any network call and enqueues `UploadOrderWorker` (WorkManager, `NetworkType.CONNECTED`, exponential backoff)
- Catalog refresh is bootstrap-on-launch plus realtime Socket.IO pushes — no periodic polling
- Payment confirmation tolerates socket loss via the poll fallback described above

---

## Hardware Target

- **Zebra KC50** kiosk computer — 1080 × 1920 portrait, mdpi (resolves to the `sw900dp` resource tier), Android 13
- Non-tablet devices are gated out via `<supports-screens requiresSmallestWidthDp="600">`
- USB HID barcode scanners (Datalogic tested); Zebra DataWedge keystroke output supported with zero code changes
- NFC required for Tap-to-Pay (Softpay companion app handles the contactless transaction)

---

## Project Structure

```
app/src/main/java/com/unlimit/pos/
├── data/            Room, Retrofit, repositories, sync (WorkManager + Socket.IO), auth prefs
│   ├── local/       AppDatabase, DAOs, entities, AuthPreferences
│   ├── remote/      ApiService, DTOs, envelope handling, interceptors
│   └── sync/        SyncManager, UploadOrderWorker, RealSocketEventHandler
├── domain/          Entities, use cases, Result/DataError, provider interfaces
│   ├── payment/     PaymentProcessor contract + PaymentResult
│   └── scanner/     ScannerProvider contract
├── feature/
│   └── language/    Self-contained API-driven localisation
├── ui/              Fragments + ViewModels per screen, ui/common/ shared helpers
└── di/              Hilt modules (network, database, coroutine scopes, processor bindings)

docs/
├── ARCHITECTURE.md          Full layer/flow reference
├── softpay/                 INTEGRATION.md, PHASE_LOG.md, exported Softpay docs
├── ui/                      typography.md, dashboard-patterns.md
└── i18n/                    localisation.md
```

---

## Build & Verify

```bash
./gradlew :app:assembleDebug                      # primary check — KSP + compile + package
./gradlew :app:compileDebugAndroidTestKotlin      # androidTest sources still compile
./gradlew :app:lintDebug                          # Android lint
./gradlew :app:testDebugUnitTest                  # JVM unit tests
```

---

## Configuration

Per-device / per-developer settings live in `local.properties` (gitignored):

| Key | Purpose |
|---|---|
| `device.login.id` / `device.login.password` | Device auth credentials (default `11223344`) |
| `use.softpay` | `true` binds the real Softpay SDK processor |
| `softpay.integrator.*`, `softpay.merchant.*`, `softpay.acquirer.store.id`, `softpay.target` | Softpay credentials + SANDBOX/PRODUCTION target |
| `signing.keystore.*`, `signing.key.*` | Release signing (falls back to debug signing if absent) |

Backend endpoints are compiled into `BuildConfig` (`API_BASE_URL`, `SOCKET_URL`); flip `USE_FAKE_API` in `app/build.gradle.kts` for offline development against `FakeApiService`.

---

## Documentation

- `CLAUDE.md` — quick-reference + guardrails (also the working instructions for the Claude Code AI agent)
- `docs/ARCHITECTURE.md` — domain/data layout, checkout flow, API contract
- `docs/softpay/INTEGRATION.md` + `docs/softpay/PHASE_LOG.md` — full payment integration history
- `docs/ui/typography.md`, `docs/ui/dashboard-patterns.md`, `docs/i18n/localisation.md`

---

*Engineered by the Unlimit / Software Alliance team. Development was accelerated using [Claude Code](https://claude.com/claude-code), Anthropic's AI coding agent, as a pair-programming tool.*
