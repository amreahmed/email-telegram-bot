# Production Deployment Guide

## 📋 Checklist Before Production

- [ ] Update `.env` with real MongoDB URI (managed MongoDB, not localhost)
- [ ] Use strong `SESSION_SECRET` and `TOKEN_ENCRYPTION_SALT`
- [ ] Test OAuth flow with real Outlook account
- [ ] Set `MS_REDIRECT_URI` to actual public domain
- [ ] Enable HTTPS reverse proxy (nginx/HAProxy)
- [ ] Configure firewall to only allow Telegram IP ranges
- [ ] Set up monitoring/alerting
- [ ] Test graceful restart (SIGTERM)

## 🚀 Deploy with PM2

```bash
# Install PM2
npm install -g pm2

# Start the app
pm2 start src/server.js --name "outlook-telegram-bot"

# Monitor in real-time
pm2 logs outlook-telegram-bot --lines 100

# Watch for auto-restart on changes
pm2 watch

# Check status
pm2 status

# Stop/restart
pm2 restart outlook-telegram-bot
pm2 stop outlook-telegram-bot

# Setup auto-start on reboot
pm2 startup
pm2 save
```

## 🛡️ Nginx Reverse Proxy Config

```nginx
upstream bot_backend {
  server 127.0.0.1:3000;
  keepalive 64;
}

server {
  listen 443 ssl http2;
  server_name your-domain.com;

  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;

  location / {
    proxy_pass http://bot_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 60;
    proxy_send_timeout 60;
    proxy_read_timeout 60;
  }

  # Rate limiting
  limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
  limit_req zone=api burst=20 nodelay;
}

# Redirect HTTP to HTTPS
server {
  listen 80;
  server_name your-domain.com;
  return 301 https://$server_name$request_uri;
}
```

## 📊 Performance Metrics

- **Max emails per check:** 500 (10 pages × 50 per page)
- **Check interval:** ~45 seconds
- **Memory usage:** ~80-120MB (Node.js + dependencies)
- **DB queries per cycle:** 2-10 depending on accounts/rules
- **Timeout:** 30 seconds for Graph API requests

## 🔍 Monitoring

### Health Check

```bash
curl https://your-domain.com/health
# Response: {"ok":true,"time":"2026-04-12T..."}
```

### Monitor Logs

```bash
pm2 logs outlook-telegram-bot

# Look for:
# - "OAuth callback received" - User linking account
# - "Polling cycle completed" - Background check finished
# - Errors with "level":"error" - Issues
```

### Monitor with CloudWatch/ELK

Send logs to external service:

```javascript
// In logger.js, add:
const winston = require("winston");
const CloudWatchTransport = require("winston-cloudwatch");

logger.add(
  new CloudWatchTransport({
    logGroupName: "outlook-telegram-bot",
    logStreamName: "production",
  }),
);
```

## 🆘 Troubleshooting

| Issue                    | Solution                                                   |
| ------------------------ | ---------------------------------------------------------- |
| Timeout on large mailbox | Reduce `maxPages` in `outlookService.js` (default: 10)     |
| High memory usage        | Check for memory leaks with `pm2 monit`                    |
| Bot not responding       | Check bot token, check logs, restart with `pm2 restart`    |
| OAuth errors             | Verify `MS_REDIRECT_URI` matches Azure config              |
| No email notifications   | Check rules exist (`/rules`), check `lastSyncAt` timestamp |

## 📈 Scale to Multiple Bots

For multiple regions/instances:

1. Use separate bot tokens
2. Same MongoDB (shared database)
3. Load balance with Nginx
4. Disable polling on all but one instance (or distribute by user ID)

## 🔐 Security Hardening

1. **Firewall**: Only allow Telegram IP ranges
2. **Environment**: Use secrets management (AWS Secrets, HashiCorp Vault)
3. **Logs**: Don't log tokens or user IDs
4. **Database**: Use IP whitelisting, strong credentials
5. **SSL**: Use Let's Encrypt with auto-renewal

## 📝 Setting MS_REDIRECT_URI for Production

1. Update Azure App Registration:
   - Go to **Authentication**
   - Update redirect URI to: `https://your-domain.com/auth/microsoft/callback`
2. Update `.env`:
   ```
   MS_REDIRECT_URI=https://your-domain.com/auth/microsoft/callback
   ```
3. Restart bot

## 🔄 Graceful Restart

```bash
# Signal the process
kill -SIGTERM $(pgrep -f 'node src/server.js')

# PM2 graceful restart
pm2 gracefulReload outlook-telegram-bot
```

Process will:

1. Stop accepting new connections
2. Finish in-flight requests (30 sec timeout)
3. Stop polling
4. Shut down bot
5. Exit (systemd/supervisor will restart)

## 📧 Production Ready Checklist

- [ ] All environment variables set
- [ ] MongoDB backed up
- [ ] HTTPS enabled
- [ ] Firewall configured
- [ ] Monitoring alerts set up
- [ ] Error logging to external service
- [ ] Rate limiting configured
- [ ] Graceful restart tested
- [ ] Load tested with expected user count
- [ ] OAuth flow tested end-to-end
- [ ] Token refresh tested
- [ ] Large mailbox (1k+ emails) tested
- [ ] Failover/recovery procedure documented

---

**You're now production-ready!** 🎉
