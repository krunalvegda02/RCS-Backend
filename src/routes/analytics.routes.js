import express from 'express';
import { 
  getCampaignAnalytics, 
  getUserAnalytics, 
  getErrorAnalysis, 
  getPerformanceMetrics 
} from '../controller/analytics.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Campaign analytics
router.get('/campaign/:campaignId', authenticateToken, getCampaignAnalytics);

// User analytics
router.get('/user/:userId', authenticateToken, getUserAnalytics);

// Error analysis
router.get('/errors/:userId', authenticateToken, getErrorAnalysis);

// Performance metrics
router.get('/performance/:userId', authenticateToken, getPerformanceMetrics);

export default router;