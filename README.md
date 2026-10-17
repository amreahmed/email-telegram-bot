# Outlook Telegram Notifier Bot

[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.18.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Microsoft%20Graph%20%7C%20Telegram-informational.svg)]()

A production-grade Telegram bot and Express synchronization engine that links authorized Microsoft Outlook mailboxes using OAuth 2.0, polls inbox folders via the Microsoft Graph API, filters messages based on customizable rules, extracts verification alerts, generates ticket reports (with Excel exports), and delivers real-time notifications to Telegram.

---

## Architecture Overview

```mermaid
flowchart TD
    User([Telegram User]) <-->|Inline Buttons / Commands| Bot[Telegraf Bot Engine]
    Bot <--> Controller[Telegram Controller]
    
    subgraph Core App [Node.js / Express Server]
        Controller <--> Polling[Polling Service]
        Controller <--> TicketService[Ticket Report Service]
        Polling <--> Outlook[Outlook Service / MSAL]
        TicketService <--> Outlook
        Outlook <--> Crypto[AES-256 Token Encryption]
    end

    Outlook <-->|REST API / OAuth 2.0| MSGraph[Microsoft Graph API]
    Core App <-->|Mongoose ODM| DB[(MongoDB)]
    TicketService -->|Generate .xlsx| ExcelExport[Excel Report Dispatcher]
    ExcelExport --> Bot
    Core App -.->|Audit Messages| AuditGroup[Telegram Audit Channels]
```

---

## Features & Highlights

### 1. Robust Microsoft Graph Integration
* **Secure OAuth 2.0 Consent:** Implements delegated Microsoft Entra ID authorization using `@azure/msal-node`.
* **Zero Plaintext Tokens:** Refresh and access tokens are encrypted at rest with **AES-256-GCM** using salt-derived keys.
* **Pagination & Large Mailboxes:** Automatically handles Microsoft Graph `@odata.nextLink` pagination with configurable batch sizes and maximum depth limits.
* **Fallback Sender Filtering:** Employs server-side OData filtering with graceful fallback to client-side streaming when tenant search restrictions apply.

### 2. High-Performance Polling Engine
* **Concurrent Worker Pools:** Multi-account polling via controlled concurrency (`asyncPool`) to prevent event-loop choking.
* **Self-Healing Cron Cycles:** Overlap prevention, exponential backoff with jitter on transient failures (`429`, `500`, `503`, `504`), and safe pause/resume primitives for manual ticket scans.
* **Per-Account Error Isolation:** Mailbox connection errors are isolated so one failing account never halts synchronization for others.

### 3. Interactive Telegram UI
* **Inline Keyboard Navigation:** Modern button-based interface with page-by-page account lists, unlinking menus, and verification status badges.
* **Backward Compatible:** Full slash-command compatibility (`/start`, `/accounts`, `/unlink`, `/rules`, `/check`, `/tickets`).
* **Real-time Progress Indicator:** Live editing of progress messages during lengthy ticket exports or mailbox inspections.

### 4. Ticket Reporting & Excel Generation
* **Bulk Ticket Inspection:** Scans active mailboxes for tickets across configured sender domains (`noreply@ahlan.sa`, etc.).
* **Spreadsheet Dispatch:** Builds formatted Excel (`.xlsx`) files on-the-fly and sends them directly via Telegram document uploads.

### 5. Production Hardening & Auditing
* **Process Resilience:** Graceful shutdown on `SIGINT` / `SIGTERM` with clean socket draining, bot disconnection, and a 10-second safety force-exit timer.
* **Request Guard:** 30-second global HTTP request timeout on the Express listener.
* **Centralized Audit Trail:** Broadcasts incoming user actions and outgoing notifications to secure admin/audit Telegram channels when `BOT_AUDIT_CHAT_IDS` is configured.

---

## Project Structure

```text
email-telegram-bot/
├── scripts/
│   ├── simulate500Otp.js         # Stress test: OTP detection simulation
│   └── simulate1000Accounts.js   # Stress test: High-volume account polling
├── src/
│   ├── app.js                    # Express app initialization & middleware
│   ├── server.js                 # Server bootstrap, bot launch & lifecycle management
│   ├── config/
│   │   ├── db.js                 # MongoDB connection logic
│   │   ├── msal.js               # Azure MSAL configuration factory
│   │   └── runtime.js            # Normalized environment settings & thresholds
│   ├── controllers/
│   │   ├── authController.js     # OAuth 2.0 initiate & callback endpoints
│   │   └── telegramController.js # Command handlers, inline actions & UI views
│   ├── models/
│   │   ├── MailLog.js            # Historical synchronization records
│   │   ├── NotificationRule.js   # User-defined regex and sender match rules
│   │   ├── OutlookAccount.js     # Linked Outlook accounts & encrypted tokens
│   │   └── TelegramUser.js       # Registered bot users & locale settings
│   ├── routes/
│   │   └── authRoutes.js         # HTTP routing for Microsoft authentication
│   ├── services/
│   │   ├── codeExtractionService.js # OTP / verification pattern matchers
│   │   ├── notificationTemplates.js # Telegram markdown/HTML message builders
│   │   ├── oauthService.js       # MSAL authorization URL & token exchange
│   │   ├── outlookService.js     # Graph API client, token refresh & mail retrieval
│   │   ├── pollingService.js     # Periodic cron scheduler & concurrent mailbox processor
│   │   ├── providerEngine.js     # Specialized provider rules & domain filters
│   │   ├── sharedAccessService.js# Permission resolution for shared/team access
│   │   ├── telegramService.js    # Bot wrapper, message rate-limiting & audit sender
│   │   └── ticketReportService.js# Ticket scanning & Excel document generation
│   └── utils/
│       ├── asyncPool.js          # Promise concurrency limiter
│       ├── crypto.js             # AES-256-GCM token encryption helpers
│       ├── helpers.js            # Formatters, text sanitizers & time utilities
│       └── logger.js             # Structured Winston logging facility
├── .env.example                  # Environment configuration template
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites

* **Node.js:** `>= 18.18.0` (LTS recommended)
* **MongoDB:** `>= 5.0`
* **Telegram Bot Token:** Obtained via [@BotFather](https://t.me/BotFather)
* **Azure App Registration:** Azure tenant with Microsoft Graph delegated permissions

---

### Step 1: Azure App Registration Setup

1. Open the [Azure Portal](https://portal.azure.com/) -> **Microsoft Entra ID** -> **App registrations** -> **New registration**.
2. **Name:** `Outlook Telegram Notifier Bot`
3. **Supported account types:**
   * Select *Accounts in any organizational directory and personal Microsoft accounts* (Multitenant) if users connect public Outlook/Hotmail accounts.
4. **Redirect URI:**
   * Platform: **Web**
   * URI: `https://your-domain.com/auth/microsoft/callback` (or `http://localhost:3000/auth/microsoft/callback` for development)
5. **Credentials:**
   * Under **Certificates & secrets**, create a new client secret. Save the **Value** (`MS_CLIENT_SECRET`).
6. **API Permissions (Delegated):**
   * Microsoft Graph:
     * `openid`
     * `profile`
     * `offline_access`
     * `User.Read`
     * `Mail.Read`

---

### Step 2: Installation & Configuration

```bash
# Clone the repository
git clone https://github.com/amreahmed/email-telegram-bot.git
cd email-telegram-bot

# Install production dependencies
npm install

# Copy environment configuration
cp .env.example .env
```

Configure your `.env` file:

```env
# Telegram
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
BOT_AUDIT_CHAT_IDS=                  # Optional: Comma-separated admin chat IDs

# Server & Database
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/outlook_telegram_bot
SESSION_SECRET=make_a_cryptographically_secure_random_key
TOKEN_ENCRYPTION_SALT=make_another_secure_random_salt

# Azure Entra ID
MS_CLIENT_ID=your-azure-application-id
MS_CLIENT_SECRET=your-azure-client-secret-value
MS_TENANT_ID=common
MS_REDIRECT_URI=https://your-domain.com/auth/microsoft/callback

# Polling & Synchronization Defaults
POLL_INTERVAL_SECONDS=45
ACCOUNT_PROCESS_CONCURRENCY=5
GRAPH_PAGE_SIZE=50
GRAPH_MAX_PAGES=10
```

---

## Environment Variables Reference

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `BOT_TOKEN` | String | *Required* | Telegram Bot API token from BotFather |
| `BOT_AUDIT_CHAT_IDS` | String | `""` | Comma-separated Telegram Chat IDs for security auditing |
| `PORT` | Number | `3000` | HTTP port for the OAuth callback listener |
| `MONGODB_URI` | String | *Required* | MongoDB connection string |
| `SESSION_SECRET` | String | *Required* | Secret used for express session signing |
| `TOKEN_ENCRYPTION_SALT` | String | *Required* | Salt string for AES-256 token encryption |
| `MS_CLIENT_ID` | String | *Required* | Azure Application (Client) ID |
| `MS_CLIENT_SECRET` | String | *Required* | Azure Client Secret Value |
| `MS_TENANT_ID` | String | `common` | Directory (Tenant) ID or `common` for multi-tenant |
| `MS_REDIRECT_URI` | String | *Required* | Fully qualified OAuth callback URL |
| `POLL_INTERVAL_SECONDS` | Number | `45` | Polling schedule interval (30s – 60s) |
| `ACCOUNT_PROCESS_CONCURRENCY`| Number | `5` | Concurrently processed mailboxes per tick |
| `GRAPH_PAGE_SIZE` | Number | `50` | Maximum messages per Graph API request |
| `GRAPH_MAX_PAGES` | Number | `10` | Maximum page depth per mailbox check cycle |
| `GRAPH_REQUEST_MAX_RETRIES` | Number | `4` | Retry count for transient network/server faults |
| `TICKET_REPORT_PAGE_SIZE` | Number | `100` | Page size when pulling ticket emails |
| `TICKET_REPORT_MAX_PAGES` | Number | `20` | Depth limit for ticket scans |
| `TICKET_REPORT_ACCOUNT_CONCURRENCY` | Number | `6` | Concurrency for batch ticket scans |

---

## Running in Production

### Option A: Using PM2 (Recommended)

```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start src/server.js --name "email-telegram-bot"

# Verify status & memory usage
pm2 status
pm2 logs email-telegram-bot --lines 50

# Configure startup on system reboot
pm2 startup
pm2 save
```

### Option B: Systemd Service (`/etc/systemd/system/email-telegram-bot.service`)

```ini
[Unit]
Description=Outlook Telegram Notifier Bot
After=network.target mongod.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/email-telegram-bot
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
EnvironmentFile=/home/ubuntu/email-telegram-bot/.env

[Install]
WantedBy=multi-user.target
```

---

## Nginx Reverse Proxy & SSL

To terminate SSL and forward OAuth traffic safely:

```nginx
server {
    listen 80;
    server_name bot.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name bot.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/bot.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bot.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_read_timeout 60s;
    }
}
```

---

## Testing & Simulation Scripts

The project includes test harnesses to validate performance under high email loads:

```bash
# Simulate 500 OTP emails with 70% match ratio in Arabic
npm run test:simulate500

# Simulate 500 OTP emails in English
npm run test:simulate500:en

# Stress-test 1,000 accounts with 15 messages each across 10 concurrent workers
npm run test:simulate1000accounts
```

---

## Security Best Practices

1. **Token Protection:** Tokens are never stored unencrypted. AES-256-GCM guarantees authentication integrity and prevents ciphertext tampering.
2. **Sanitized Telegram Output:** Email previews are stripped of harmful HTML/script tags before transmission to avoid formatting injection.
3. **Audit Controls:** Keep `BOT_AUDIT_CHAT_IDS` set to a private channel monitored solely by system administrators to maintain real-time operational oversight.

---

## License

This project is licensed under the [MIT License](LICENSE).
