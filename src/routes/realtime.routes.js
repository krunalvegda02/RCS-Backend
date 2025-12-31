import express from 'express';
import { 
  getRealTimeCampaignStats,
  getLiveMessageFeed,
  getRecentWebhookEvents,
  getMessageStatusBreakdown,
  getUserInteractionSummary,
  getUserStats
} from '../controller/realtime.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Real-time campaign stats
router.get('/campaign/:campaignId/stats', authenticateToken, getRealTimeCampaignStats);

// Live message feed
router.get('/campaign/:campaignId/feed', authenticateToken, getLiveMessageFeed);

// Recent webhook events
router.get('/user/:userId/events', authenticateToken, getRecentWebhookEvents);

// User stats
router.get('/user/:userId/stats', authenticateToken, getUserStats);

// Message status breakdown
router.get('/campaign/:campaignId/breakdown', authenticateToken, getMessageStatusBreakdown);

// User interaction summary
router.get('/campaign/:campaignId/interactions', authenticateToken, getUserInteractionSummary);

export default router;