#!/bin/bash

# Setup cron job for campaign stats sync
# Run this script to set up automatic stats sync every 5 minutes

BACKEND_PATH="/Users/stzkdigitalmedia/Desktop/RCS_MESSAGING/BACKEND"
LOG_PATH="/var/log/campaign-stats-sync.log"

# Create log file if it doesn't exist
sudo touch $LOG_PATH
sudo chmod 666 $LOG_PATH

# Add cron job for recent campaigns only (last 4 days)
(crontab -l 2>/dev/null; echo "*/5 * * * * cd $BACKEND_PATH && node scripts/syncCampaignStats.js all recent >> $LOG_PATH 2>&1") | crontab -

echo "✅ Cron job set up successfully!"
echo "📊 Campaign stats will sync every 5 minutes"
echo "📝 Logs will be written to: $LOG_PATH"
echo ""
echo "To check cron jobs: crontab -l"
echo "To view logs: tail -f $LOG_PATH"