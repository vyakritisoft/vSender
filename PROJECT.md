# PROJECT.md (Production-Grade)

## 1. Product Overview
A Chrome Extension (Manifest V3) enabling controlled, compliant bulk messaging via WhatsApp Web with CSV/XLSX ingestion, personalization, media support, and a safety-first delivery engine.

## 2. Goals
- Reliable delivery with minimal ban risk
- Deterministic queue with observability
- Extensible architecture for future API migration

## 3. Non-Goals
- No unofficial APIs or reverse-engineering of private endpoints
- No high-throughput blasting

## 4. Key Features
- CSV/XLSX ingestion with schema mapping & validation
- Templating engine with variables and fallbacks
- Media attachments (image/pdf)
- Queue with rate limiting, jitter, pause/resume/stop
- Retry policy with backoff
- Duplicate detection & idempotency
- Progress, logs, export

## 5. User Journey
Upload → Map → Preview → Configure → Start → Monitor → Export

## 6. Architecture Summary
- Popup UI (React or Vanilla)
- Background Service Worker (orchestrator)
- Content Script (DOM automation)
- Shared modules (parser, queue, templating, validators)

## 7. Folder Structure
/extension
  manifest.json
  /src
    background/
    content/
    popup/
    core/
      queue/
      parser/
      templating/
      rateLimiter/
      logger/

## 8. Roadmap
v1: Text + CSV + queue
v2: Media + retries + logs
v3: Scheduling + analytics + profiles

## 9. Risks & Mitigation
- Ban risk → strict rate limits, jitter, session caps
- DOM changes → selector abstraction layer
- Failures → retries + checkpoints
