import express from 'express';
import * as CampaignController from '../controller/campaign.controller.js';
import { authenticateToken, requireUser, requireAdmin, checkWalletBalance } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Admin routes (no user restriction)
router.get('/admin/campaigns/export/all', authenticateToken, requireAdmin, CampaignController.getAllCampaignsForExport);
router.get('/admin/campaigns/:id/messages', authenticateToken, requireAdmin, CampaignController.getCampaignMessages);
router.get('/admin/campaigns', authenticateToken, requireAdmin, CampaignController.getAllForAdmin);

// All other campaign routes require authentication and user role
router.use(authenticateToken);
router.use(requireUser);

// Check RCS capability for batch of numbers
router.post('/check-capability', CampaignController.checkCapability);

// Send bulk messages (create and start campaign)
router.post('/send-bulk', checkWalletBalance(1), CampaignController.create);

// Create simple campaign record (for contact upload integration)
router.post('/', CampaignController.createSimple);
router.get('/', CampaignController.getAll);
router.get('/:id', CampaignController.getById);
router.get('/:id/stats', CampaignController.getStats);
router.get('/:id/messages', CampaignController.getCampaignMessages);
router.post('/:id/start', CampaignController.start);
router.post('/:id/pause', CampaignController.pause);
router.post('/:id/restart', CampaignController.restart);

export default router;
