/**
 * AUTO-SYNC INTEGRATION GUIDE
 * 
 * Stats sync automatically between sub-campaigns and master campaign
 */

// 1. WEBHOOK INTEGRATION - Add to webhook.controller.js
import { autoSyncCampaignStats } from '../middlewares/campaignSync.middleware.js';

// After updating message status:
setImmediate(() => autoSyncCampaignStats(campaignId));

// 2. PERIODIC SYNC - Add to server.js
import { schedulePeriodicSync } from './middlewares/campaignSync.middleware.js';
schedulePeriodicSync(); // Syncs every 30 seconds

// 3. MANUAL SYNC
const campaign = await Campaign.findById(campaignId);
await campaign.syncStats(); // Syncs sub-campaign → master

// 4. MASTER SYNC
const master = await Campaign.findOne({ _id: id, isMaster: true });
await master.syncMasterStats(); // Aggregates all sub-campaigns
