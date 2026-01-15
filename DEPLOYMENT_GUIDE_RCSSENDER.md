# Deployment Guide for rcssender.com

## Your Setup
```
Domain: rcssender.com
Frontend: /var/www/rcs-frontend (React build → dist/)
Backend: /var/www/rcs-backend (PM2 on port 5000)
```

## Step-by-Step Deployment

### 1. Clone Repositories
```bash
cd /var/www

# Clone frontend
  git clone YOUR_FRONTEND_REPO_URL rcs-frontend

# Clone backend
git clone YOUR_BACKEND_REPO_URL rcs-backend
```

### 2. Build Frontend
```bash
cd /var/www/rcs-frontend
npm install
npm run build

# Verify build created
ls -la dist/
# Should see: index.html, assets/, etc.
```

### 3. Setup Backend
```bash
cd /var/www/rcs-backend
npm install

# Create .env file
nano .env
```

Add to `.env`:
```env
PORT=5000
MONGODB_URI=your_mongodb_uri
KAFKA_BROKER=localhost:9092
REDIS_HOST=localhost
REDIS_PORT=6379
CORS_ORIGIN=http://rcssender.com
```

### 4. Configure Nginx

#### Update Main Config
```bash
sudo nano /etc/nginx/nginx.conf
```
Copy content from `nginx.conf.optimized`

#### Create Site Config
```bash
sudo nano /etc/nginx/sites-available/rcssender
```
Copy content from `nginx-complete.conf` (already has rcssender.com)

#### Enable Site
```bash
# Remove default
sudo rm /etc/nginx/sites-enabled/default

# Enable rcssender
sudo ln -s /etc/nginx/sites-available/rcssender /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Reload
sudo systemctl reload nginx
```

### 5. Start Backend with PM2
```bash
cd /var/www/rcs-backend

# Start all services
pm2 start ecosystem.config.cjs

# Save PM2 config
pm2 save

# Setup PM2 startup
pm2 startup
# Run the command it outputs
```

### 6. Verify Deployment

#### Check Frontend
```bash
curl http://rcssender.com/
# Should return HTML
```

#### Check Backend
```bash
curl http://rcssender.com/api/v1/health
# Should return JSON
```

#### Check PM2
```bash
pm2 status
# Should show all workers running
```

#### Check Nginx
```bash
sudo systemctl status nginx
# Should be active (running)
```

## File Structure
```
/var/www/
├── rcs-frontend/
│   ├── src/
│   ├── dist/              ← Nginx serves from here
│   │   ├── index.html
│   │   └── assets/
│   ├── package.json
│   └── vite.config.js
│
└── rcs-backend/
    ├── src/
    ├── .env               ← Your environment variables
    ├── package.json
    └── ecosystem.config.cjs
```

## Update Deployment

### Update Frontend
```bash
cd /var/www/rcs-frontend
git pull
npm install
npm run build
# Nginx automatically serves new build
```

### Update Backend
```bash
cd /var/www/rcs-backend
git pull
npm install
pm2 restart all
```

## DNS Configuration

Point your domain to your server:
```
A Record: rcssender.com → YOUR_SERVER_IP
A Record: www.rcssender.com → YOUR_SERVER_IP
```

## SSL Certificate (Optional but Recommended)

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d rcssender.com -d www.rcssender.com

# Auto-renewal is configured automatically
```

After SSL, nginx will automatically redirect HTTP → HTTPS

## Monitoring

### Check Logs
```bash
# Nginx access log
sudo tail -f /var/log/nginx/access.log

# Nginx error log
sudo tail -f /var/log/nginx/error.log

# PM2 logs
pm2 logs

# Specific worker
pm2 logs api
pm2 logs kafka-consumer
```

### Check Performance
```bash
# PM2 monitoring
pm2 monit

# System resources
htop
```

## Troubleshooting

### Frontend not loading
```bash
# Check build exists
ls -la /var/www/rcs-frontend/dist/

# Check nginx config
sudo nginx -t

# Check nginx is running
sudo systemctl status nginx
```

### Backend not responding (502)
```bash
# Check PM2
pm2 status

# Check backend is on port 5000
pm2 logs api | grep "listening"

# Test backend directly
curl http://localhost:5000/api/v1/health
```

### Webhooks not working
```bash
# Check webhook endpoint
curl -X POST http://rcssender.com/api/v1/jio/rcs/webhooks \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'

# Check PM2 logs
pm2 logs api --lines 50
```

## Quick Commands

```bash
# Restart everything
pm2 restart all && sudo systemctl reload nginx

# View all logs
pm2 logs --lines 100

# Check what's using port 5000
sudo lsof -i :5000

# Check nginx syntax
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

## URLs

- **Frontend**: http://rcssender.com
- **Backend API**: http://rcssender.com/api
- **Webhooks**: http://rcssender.com/api/v1/jio/rcs/webhooks
- **Health Check**: http://rcssender.com/api/v1/health

## Success Checklist

- [ ] Frontend repo cloned to /var/www/rcs-frontend
- [ ] Backend repo cloned to /var/www/rcs-backend
- [ ] Frontend built (dist/ folder exists)
- [ ] Backend .env configured
- [ ] Nginx main config updated
- [ ] Nginx site config created
- [ ] PM2 services running
- [ ] Frontend loads at rcssender.com
- [ ] API responds at rcssender.com/api
- [ ] DNS points to server
- [ ] SSL certificate installed (optional)

---

**Domain**: rcssender.com
**Frontend Path**: /var/www/rcs-frontend/dist
**Backend Path**: /var/www/rcs-backend
**Backend Port**: 5000
