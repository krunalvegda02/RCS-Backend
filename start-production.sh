#!/bin/bash

echo "🚀 RCS Messaging System - Quick Start"
echo "======================================"
echo ""

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 not found. Installing..."
    npm install -g pm2
fi

# Create logs directory
mkdir -p logs

echo "✅ Starting all services with PM2..."
pm2 start ecosystem.config.cjs

echo ""
echo "✅ Installing cron jobs..."
./setup-cron.sh

echo ""
echo "✅ Running initial cleanup..."
npm run cleanup-campaigns

echo ""
echo "======================================"
echo "🎉 System Started Successfully!"
echo "======================================"
echo ""
echo "Services running:"
pm2 status
echo ""
echo "Cron jobs installed:"
crontab -l | grep "RCS Messaging" -A 1
echo ""
echo "📊 Check wallet status:"
echo "   node scripts/findAllBlocked.js"
echo ""
echo "📝 View logs:"
echo "   pm2 logs"
echo ""
echo "🛑 Stop all services:"
echo "   pm2 stop all"
echo ""
echo "✅ All systems operational!"
