import express from 'express';
import { 
  generateCampaignReport, 
  getCampaignReport, 
  getUserCampaignReports, 
  deleteCampaignReport 
} from '../controller/campaignReport.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Generate report for a campaign
router.post('/generate/:campaignId', authenticateToken, generateCampaignReport);

// Get report by campaign ID
router.get('/campaign/:campaignId', authenticateToken, getCampaignReport);

// Get all reports for a user
router.get('/user/:userId', authenticateToken, getUserCampaignReports);

// Delete campaign report
router.delete('/campaign/:campaignId', authenticateToken, deleteCampaignReport);

export default router;