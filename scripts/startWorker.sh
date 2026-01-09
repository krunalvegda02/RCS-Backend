#!/bin/bash

echo "🚀 Starting RCS Message Log Processor"
echo "======================================"
echo ""
echo "This will process webhook logs every 10 seconds in real-time"
echo ""

cd "$(dirname "$0")/.."

# Check if PM2 is installed
if command -v pm2 &> /dev/null; then
    echo "Using PM2..."
    pm2 start src/workers/worker.js --name rcs-worker
    pm2 save
    echo ""
    echo "✅ Worker started with PM2"
    echo ""
    echo "Commands:"
    echo "  pm2 logs rcs-worker    - View logs"
    echo "  pm2 restart rcs-worker - Restart"
    echo "  pm2 stop rcs-worker    - Stop"
else
    echo "PM2 not found. Starting with node..."
    echo ""
    nohup node src/workers/worker.js > logs/worker.log 2>&1 &
    echo $! > logs/worker.pid
    echo "✅ Worker started (PID: $(cat logs/worker.pid))"
    echo ""
    echo "Commands:"
    echo "  tail -f logs/worker.log - View logs"
    echo "  kill \$(cat logs/worker.pid) - Stop"
fi

echo ""
echo "Worker will process logs every 10 seconds automatically"
