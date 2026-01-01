import express from 'express';
import * as CampaignController from '../controller/campaign.controller.js';
import { authenticateToken, requireUser, checkWalletBalance } from '../middlewares/auth.middleware.js';

const router = express.Router();

// All campaign routes require authentication
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
router.post('/:id/start', CampaignController.start);
router.post('/:id/pause', CampaignController.pause);
router.post('/:id/restart', CampaignController.restart);

export default router;
