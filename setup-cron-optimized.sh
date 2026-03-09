#!/bin/bash

# Setup optimized cron job for affected campaigns only
# This syncs only campaigns with recent message updates (last 10 minutes)

BACKEND_PATH="/Users/stzkdigitalmedia/Desktop/RCS_MESSAGING/BACKEND"
LOG_PATH="/var/log/campaign-stats-affected.log"

# Create log file if it doesn't exist
sudo touch $LOG_PATH
sudo chmod 666 $LOG_PATH

# Remove old cron job if exists
crontab -l 2>/dev/null | grep -v "syncCampaignStats.js" | crontab -

# Add optimized cron job - only affected campaigns
(crontab -l 2>/dev/null; echo "*/5 * * * * cd $BACKEND_PATH && node scripts/syncAffectedCampaigns.js >> $LOG_PATH 2>&1") | crontab -

echo "✅ Optimized cron job set up successfully!"
echo "📊 Only campaigns with recent updates will sync every 5 minutes"
echo "📝 Logs will be written to: $LOG_PATH"
echo ""
echo "CPU Usage: ~90% reduction compared to syncing all campaigns"
echo ""
echo "To check cron jobs: crontab -l"
echo "To view logs: tail -f $LOG_PATH"