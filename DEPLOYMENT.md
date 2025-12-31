# Deploy RCS Backend to rcssender.com

## Prerequisites
- Domain: rcssender.com pointing to your server
- Server: Ubuntu/Linux with Node.js 18+
- SSL Certificate (Let's Encrypt)

## Step 1: Server Setup

```bash
# SSH into your server
ssh user@rcssender.com

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install Nginx
sudo apt-get install -y nginx

# Install Certbot for SSL
sudo apt-get install -y certbot python3-certbot-nginx
```

## Step 2: Upload Your Code

```bash
# On your local machine
cd /Users/stzkdigitalmedia/Desktop/RCS_MESSAGING/BACKEND
rsync -avz --exclude 'node_modules' --exclude '.env' . user@rcssender.com:/var/www/rcs-backend/

# Or use Git
git push origin main
# Then on server:
cd /var/www/rcs-backend
git pull origin main
```

## Step 3: Install Dependencies

```bash
# On server
cd /var/www/rcs-backend
npm install --production
```

## Step 4: Configure Environment

```bash
# Create .env file on server
nano /var/www/rcs-backend/.env
```

Add:
```env
NODE_ENV=production
PORT=3000
MONGODB_URI=your_mongodb_uri
REDIS_HOST=localhost
REDIS_PORT=6379
JIO_API_BASE_URL=https://api.businessmessaging.jio.com
JWT_SECRET=your_jwt_secret
WEBHOOK_URL=https://rcssender.com/api/v1/webhooks/jio/rcs
```

## Step 5: Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/rcssender.com
```

Add:
```nginx
server {
    listen 80;
    server_name rcssender.com www.rcssender.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Webhook specific settings
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/rcssender.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## Step 6: Setup SSL Certificate

```bash
sudo certbot --nginx -d rcssender.com -d www.rcssender.com
```

## Step 7: Start Application with PM2

```bash
cd /var/www/rcs-backend
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## Step 8: Configure Jio RCS Webhook

1. Login to Jio RCS Portal: https://rbm.jio.com
2. Go to Settings → Webhooks
3. Set webhook URL: `https://rcssender.com/api/v1/webhooks/jio/rcs`
4. Save configuration

## Step 9: Test Webhook

```bash
# Test endpoint
curl https://rcssender.com/api/v1/webhooks/test

# Monitor logs
pm2 logs rcs-backend

# Check status
pm2 status
```

## Useful PM2 Commands

```bash
# View logs
pm2 logs rcs-backend

# Restart app
pm2 restart rcs-backend

# Stop app
pm2 stop rcs-backend

# Monitor
pm2 monit

# View detailed info
pm2 info rcs-backend
```

## Monitoring Webhooks

```bash
# Real-time logs
pm2 logs rcs-backend --lines 100

# Filter webhook logs
pm2 logs rcs-backend | grep "Webhook"

# Check Redis queue
redis-cli
> KEYS webhook-processing:*
> LLEN webhook-processing:wait
```

## Troubleshooting

1. **Webhooks not received:**
   - Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
   - Check firewall: `sudo ufw status`
   - Verify DNS: `nslookup rcssender.com`

2. **App crashes:**
   - Check logs: `pm2 logs rcs-backend --err`
   - Check memory: `pm2 info rcs-backend`
   - Restart: `pm2 restart rcs-backend`

3. **Database connection:**
   - Test MongoDB: `mongo your_mongodb_uri`
   - Check Redis: `redis-cli ping`

## Security

```bash
# Setup firewall
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable

# Secure MongoDB
# Use MongoDB Atlas or secure local instance

# Secure Redis
sudo nano /etc/redis/redis.conf
# Set: bind 127.0.0.1
# Set: requirepass your_redis_password
sudo systemctl restart redis
```

## Auto-restart on Server Reboot

PM2 will automatically restart your app on server reboot after running:
```bash
pm2 startup
pm2 save
```

## Done! 🎉

Your webhook is now running 24/7 at:
- **Webhook URL:** https://rcssender.com/api/v1/webhooks/jio/rcs
- **Test URL:** https://rcssender.com/api/v1/webhooks/test
- **Status:** Always running with PM2
- **Auto-restart:** Enabled
- **SSL:** Secured with Let's Encrypt
