import express from 'express';
import { 
  generateCampaignReport, 
  getCampaignReport, 
  getUserCampaignReports, 
  getCampaignMessages 
} from '../controller/campaignReport.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Generate report for a campaign
router.post('/generate/:campaignId', authenticateToken, generateCampaignReport);

// Get report by campaign ID
router.get('/campaign/:campaignId', authenticateToken, getCampaignReport);

// Get campaign messages
router.get('/campaign/:campaignId/messages', authenticateToken, getCampaignMessages);

// Get all reports for a user
router.get('/user/:userId', authenticateToken, getUserCampaignReports);

export default router;