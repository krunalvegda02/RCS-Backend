#!/bin/bash

echo "🔍 Production Deployment Checklist"
echo "=================================="

echo ""
echo "1. 📁 Checking .env file location..."
if [ -f ".env" ]; then
    echo "✅ .env file found in current directory"
    echo "📍 .env file path: $(pwd)/.env"
else
    echo "❌ .env file not found in current directory"
fi

echo ""
echo "2. 🔐 Checking environment variables..."
if [ -n "$MONGODB_URI" ]; then
    echo "✅ MONGODB_URI is set in environment"
    # Mask password for security
    MASKED_URI=$(echo $MONGODB_URI | sed 's/:\/\/[^:]*:[^@]*@/:\/\/****:****@/')
    echo "📍 MONGODB_URI: $MASKED_URI"
else
    echo "❌ MONGODB_URI not found in environment variables"
fi

echo ""
echo "3. 🔄 Checking Node.js processes..."
if pgrep -f "node.*index.js" > /dev/null; then
    echo "✅ Node.js processes are running"
    echo "📊 Process IDs:"
    pgrep -f "node.*index.js" | while read pid; do
        echo "   PID: $pid"
    done
else
    echo "❌ No Node.js processes found"
fi

echo ""
echo "4. 📦 Checking PM2 processes (if using PM2)..."
if command -v pm2 &> /dev/null; then
    echo "✅ PM2 is installed"
    pm2 list
else
    echo "ℹ️  PM2 not installed or not in PATH"
fi

echo ""
echo "5. 🔧 Production deployment steps:"
echo "   1. Stop all Node.js processes: pm2 stop all (or kill processes)"
echo "   2. Update .env file with new MONGODB_URI"
echo "   3. Restart application: pm2 restart all (or start fresh)"
echo "   4. Check logs: pm2 logs"
echo "   5. Test connection: node scripts/testConnection.js"

echo ""
echo "6. 🚨 Emergency rollback:"
echo "   - Keep backup of old .env file"
echo "   - If issues occur, restore old .env and restart"

echo ""
echo "=================================="
echo "Run this script in your production server directory"