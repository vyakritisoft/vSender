# DESIGN.md (Production-Grade)

## 1. System Architecture

[Popup UI] ⇄ [Background Worker] ⇄ [Content Script] ⇄ [WhatsApp Web DOM]

## 2. Manifest (MV3)
- permissions: storage, scripting, activeTab
- host_permissions: https://web.whatsapp.com/*
- background: service_worker

## 3. Modules

### 3.1 Queue Engine
State machine:
PENDING → SENDING → SENT | FAILED | RETRY

Data model:
{
 id,
 phone,
 variables,
 message,
 media,
 attempts,
 status
}

### 3.2 Rate Limiter
- Base delay (user input)
- Jitter ±20–30%
- Session cap (e.g., 50–100 msgs/session)

Pseudo:
delay = base + random(-0.3*base, 0.3*base)

### 3.3 Retry Policy
- Max attempts: 2–3
- Backoff: exponential
retryDelay = base * (2 ^ attempts)

### 3.4 Parser
- CSV/XLSX parsing
- Normalize phone numbers (E.164)
- Schema validation

### 3.5 Template Engine
- {{variable}} replacement
- Fallback: empty or default

### 3.6 Content Automation Layer
Selector abstraction:
- search box
- message input
- send button
- attach button

Steps:
1. Open chat (wa.me or search)
2. Wait for DOM ready (MutationObserver)
3. Inject message
4. Simulate typing (char-by-char optional)
5. Send

### 3.7 Media Flow
- Trigger attach
- Upload file
- Wait preview
- Send

### 3.8 Error Handling
- Timeout detection
- Invalid number detection
- DOM missing elements fallback

### 3.9 Logging
- In-memory + chrome.storage
- Levels: info, warn, error

## 4. Data Flow
CSV → Parse → Validate → Queue → RateLimiter → Content Script → Send → Log

## 5. Communication
chrome.runtime.sendMessage
Event types:
- START
- PAUSE
- RESUME
- STOP
- STATUS_UPDATE

## 6. Anti-Ban Strategy
- Random delays
- Session caps
- Human-like typing simulation
- Avoid parallel sends
- Idle cooldown after batch

## 7. Persistence
chrome.storage.local:
- queue snapshot
- settings
- logs

## 8. Extensibility
- Swap DOM layer with official API later
- Add scheduler service
- Multi-account support

## 9. Edge Cases
- Network loss
- WhatsApp logout
- File parsing errors
- Duplicate rows

## 10. Testing Strategy
- Unit: parser, templating, queue
- Integration: message flow
- Manual: WhatsApp DOM

