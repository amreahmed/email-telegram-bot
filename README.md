# Outlook Telegram Notifier Bot

Production-ready Node.js Telegram bot that connects authorized Outlook mailboxes using Microsoft OAuth 2.0, polls inbox messages via Microsoft Graph, applies user-defined filtering rules, and sends safe Telegram notifications.

## Security and Scope

- Supports only authorized mailbox owners via Microsoft OAuth consent.
- Optional domain restriction using `ALLOWED_MAIL_DOMAINS` (organization-only mode).
- Does not extract or process OTPs, passwords, verification codes, or authentication secrets.
- Notifications include only safe fields: sender, subject, received time, preview, account email.
- Access and refresh tokens are encrypted at rest using AES-256-GCM.

## Tech Stack

- Node.js (CommonJS)
- Express.js
- Telegraf
- MongoDB + Mongoose
- Microsoft Graph API
- `@azure/msal-node`
- `dotenv`
- `node-cron`

## Project Structure

```text
src/
  app.js
  server.js
  config/
    db.js
    msal.js
  models/
    TelegramUser.js
    OutlookAccount.js
    NotificationRule.js
    MailLog.js
  services/
    telegramService.js
    outlookService.js
    oauthService.js
    pollingService.js
  controllers/
    authController.js
    telegramController.js
  routes/
    authRoutes.js
  utils/
    logger.js
    helpers.js
    crypto.js
```

## 1) Install and Configure

```bash
npm install
cp .env.example .env
```

Fill `.env`:

```env
BOT_TOKEN=your_telegram_bot_token
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/outlook_telegram_bot
SESSION_SECRET=replace_with_a_long_random_secret
MS_CLIENT_ID=your_azure_app_client_id
MS_CLIENT_SECRET=your_azure_app_client_secret
MS_TENANT_ID=common
MS_REDIRECT_URI=http://localhost:3000/auth/microsoft/callback
ALLOWED_MAIL_DOMAINS=
POLL_INTERVAL_SECONDS=45
TOKEN_ENCRYPTION_SALT=replace_with_a_random_salt_value
```

## 2) Azure App Registration Setup

1. Go to Azure Portal -> Microsoft Entra ID -> App registrations -> New registration.
2. Name: e.g. `Outlook Telegram Notifier`.
3. Supported account types:
   - Single tenant for organization-only.
   - Multi-tenant if needed.
4. Redirect URI (Web):
   - `http://localhost:3000/auth/microsoft/callback`
5. Create app and copy:
   - Application (client) ID -> `MS_CLIENT_ID`
   - Directory (tenant) ID -> `MS_TENANT_ID` (or use `common`)
6. Create client secret under Certificates & secrets -> `MS_CLIENT_SECRET`.

### Required Microsoft Graph API Permissions (Delegated)

- `openid`
- `profile`
- `offline_access`
- `User.Read`
- `Mail.Read`

Grant admin consent if your organization requires it.

## 3) Run Locally

```bash
npm run dev
```

Or production mode:

```bash
npm start
```

## 4) Telegram Bot Commands

- `/start` - register user and show usage
- `/connect` - generate Microsoft OAuth URL
- `/accounts` - list connected Outlook accounts
- `/rules` - list active filter rules
- `/addrule` - add rule
- `/removerule` - disable rule
- `/check` - manual inbox check now

### Add Rule Format

```text
/addrule sender=amazon.com;subject=invoice;attachment=true;account=me@company.com
```

Fields:

- `sender` optional
- `subject` optional
- `attachment` optional (`true` or `false`)
- `account` optional (email). If omitted, latest active account is used.

At least one of `sender`, `subject`, or `attachment` must be set.

## 5) OAuth Flow and Account Linking

1. User sends `/connect` in Telegram.
2. Bot sends OAuth URL with secure state.
3. User signs in and consents.
4. Callback `/auth/microsoft/callback` validates state and exchanges code.
5. System reads mailbox profile from Graph and saves encrypted tokens.
6. Bot confirms linked account in Telegram.

## 6) Polling and Notifications

- Background polling runs every 30-60 seconds (`POLL_INTERVAL_SECONDS`, clamped).
- For each active account:
  - Load active rules.
  - Fetch inbox messages newer than `lastSyncAt`.
  - Match rule conditions.
  - Prevent duplicates via `MailLog` unique index (`accountId + messageId`).
  - Send safe Telegram notification.

Notification format:

```text
New email matched
From: sender@example.com
Subject: Example Subject
Received: 2026-04-12T12:34:56.000Z
Preview: Short preview text...
Account: mailbox@example.com
```

## 7) Reconnect / Re-auth Behavior

- If refresh token fails or is missing, the account is marked inactive.
- User can run `/connect` again to re-authorize and reactivate token flow.

## 8) Test with One Outlook Account First

1. Start app locally.
2. Open Telegram and send `/start`.
3. Send `/connect` and complete OAuth with one mailbox.
4. Send `/accounts` and verify account is active.
5. Add a simple rule:

```text
/addrule subject=test
```

6. Send a test email to that Outlook inbox with subject containing `test`.
7. Trigger manual check with `/check` or wait for polling cycle.
8. Confirm Telegram receives a notification once (no duplicates on repeated checks).

## 9) Production Notes

- Run behind HTTPS reverse proxy.
- Use managed MongoDB and network restrictions.
- Rotate `SESSION_SECRET` and `TOKEN_ENCRYPTION_SALT` safely.
- Use process manager (PM2/systemd/Kubernetes).
- Add centralized log shipping.
- Consider queue-based polling (BullMQ) if scaling beyond simple cron.
