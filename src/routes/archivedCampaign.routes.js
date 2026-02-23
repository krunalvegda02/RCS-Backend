import express from 'express';
import * as ArchivedCampaignController from '../controller/archivedCampaign.controller.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Admin routes
router.get('/users', authenticateToken, requireAdmin, ArchivedCampaignController.getUsersWithArchives);
router.get('/', authenticateToken, requireAdmin, ArchivedCampaignController.getArchivedCampaigns);
router.get('/:id', authenticateToken, requireAdmin, ArchivedCampaignController.getArchivedCampaign);
router.delete('/:id', authenticateToken, requireAdmin, ArchivedCampaignController.deleteArchivedCampaign);

export default router;
