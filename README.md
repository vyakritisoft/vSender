# vSender - Bulk WhatsApp Sender

**vSender** is a production-grade Chrome Extension (Manifest V3) designed for controlled and compliant bulk messaging via WhatsApp Web. It features a robust delivery engine with safety-first rate limiting, message scheduling, and support for personalized templates from CSV/XLSX files.

## 🚀 Key Features

- **Automated Queuing**: FIFO queue with distinct states (PENDING, SENDING, SENT, FAILED, RETRY).
- **Message Scheduling**: Plan your campaigns for any future date and time using the reliable `chrome.alarms` API.
- **Smart Rate Limiting**: Human-like randomized delays (jitter) and configurable session caps to minimize ban risk.
- **Template Engine**: Personalize messages using `{{variable}}` syntax from your uploaded data.
- **Media Support**: Attach images and PDFs to your bulk campaigns.
- **Data Ingestion**: Support for CSV and XLSX files with easy field mapping and validation.
- **Privacy First**: local-only execution; no unofficial APIs or server-side message storage.

## 🛠️ Tech Stack

- **Platform**: Chrome Extension Manifest V3
- **Language**: Vanilla JavaScript (ES6+)
- **Storage**: `chrome.storage.local` for queue persistence and logs.
- **Automation**: DOM-based interaction (no private APIs).
- **External Libraries**: [SheetJS (xlsx.js)](https://sheetjs.com/) for XLSX processing.

## 📁 Project Structure

```
/extension
  ├── manifest.json         # Extension configuration
  ├── icons/                # Branding assets
  ├── libs/                 # External dependencies (SheetJS)
  └── src/
      ├── background/       # Service Worker (Orchestrator)
      ├── content/          # Automation Layer (DOM interaction)
      ├── popup/            # User Interface (HTML/CSS/JS)
      └── core/             # Business Logic
          ├── queue/        # State Machine & Queue Engine
          ├── parser/       # CSV/XLSX Validation & Parsing
          ├── templating/   # Variable Injection Engine
          ├── rateLimiter/  # Delay & Jitter Logic
          └── logger/       # Activity & Error Tracking
```

## ⚙️ Installation

1.  Clone this repository:
    ```bash
    git clone https://github.com/vyakritisoft/vSender
    ```
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable **Developer mode** (top right corner).
4.  Click **Load unpacked** and select the `/extension` directory from the cloned repository.

## 📖 Usage Guide

1.  **Preparation**: Prepare a CSV or XLSX file with a column for phone numbers and any other variables (e.g., `Name`).
2.  **Upload**: Click the vSender icon in your toolbar and upload your file.
3.  **Mapping**: Map the phone number field and use `{{ColumnName}}` in your message template.
4.  **Configuration**: Set your preferred delay and optional schedule.
5.  **Execution**: Click "Start" and keep the WhatsApp Web tab open.

## 🛡️ Anti-Ban Strategy

vSender is built with safety as a priority:
- **One-by-One Sending**: No parallel executions.
- **Randomized Jitter**: Custom delays with ±20-30% variance.
- **Session Caps**: Limit the number of messages sent per session.
- **Human Simulation**: Mimics manual interaction patterns.

## 🗺️ Roadmap

- [x] Core Messaging Engine (v1)
- [x] Media Attachments & Retries (v2)
- [x] Message Scheduling & Analytics (v3)
- [ ] Official API Integration Layer
- [ ] Multi-account Profile Management

## 📄 License

This project is proprietary. Please refer to [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for data handling details.
