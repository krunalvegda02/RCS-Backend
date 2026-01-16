#!/bin/bash

# RCS Messaging System - Crontab Setup
# This script sets up automatic cleanup jobs

BACKEND_DIR="/Users/stzkdigitalmedia/Desktop/RCS_MESSAGING/BACKEND"

echo "Setting up cron jobs for RCS Messaging System..."

# Create cron jobs
(crontab -l 2>/dev/null; echo "# RCS Messaging - Expire pending messages every 5 minutes") | crontab -
(crontab -l 2>/dev/null; echo "*/5 * * * * cd $BACKEND_DIR && npm run expire-messages >> logs/expire-messages.log 2>&1") | crontab -

(crontab -l 2>/dev/null; echo "# RCS Messaging - Cleanup stuck campaigns every 10 minutes") | crontab -
(crontab -l 2>/dev/null; echo "*/10 * * * * cd $BACKEND_DIR && npm run cleanup-campaigns >> logs/cleanup-campaigns.log 2>&1") | crontab -

echo "✅ Cron jobs installed successfully!"
echo ""
echo "Installed jobs:"
crontab -l | grep "RCS Messaging" -A 1

echo ""
echo "To remove these cron jobs, run: crontab -e"
