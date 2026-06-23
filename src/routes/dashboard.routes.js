import express from 'express';
import { getUserDashboardStats, getUserRecentCampaigns, addWalletRequest, getAdminDashboard, getAdminSummary, getMonthlyAnalytics, getWeeklyAnalytics, getMonthlyStats } from '../controller/dashboard.controller.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware.js';
import { cacheMiddleware } from '../middlewares/cache.middleware.js';

const router = express.Router();

router.get('/admin', authenticateToken, requireAdmin, cacheMiddleware, getAdminDashboard);
router.get('/admin/summary', authenticateToken, requireAdmin, cacheMiddleware, getAdminSummary);
router.get('/admin/monthly-stats', authenticateToken, requireAdmin, cacheMiddleware, getMonthlyStats);
router.get('/admin/monthly/:userId', authenticateToken, requireAdmin, cacheMiddleware, getMonthlyAnalytics);
router.get('/admin/weekly/:userId', authenticateToken, requireAdmin, cacheMiddleware, getWeeklyAnalytics);

router.get('/stats/:userId', authenticateToken, cacheMiddleware, getUserDashboardStats);
router.get('/recent-campaigns/:userId', authenticateToken, cacheMiddleware, getUserRecentCampaigns);
router.post('/wallet-request', authenticateToken, addWalletRequest);

export default router;