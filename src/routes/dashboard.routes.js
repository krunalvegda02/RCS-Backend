import express from 'express';
import { getDashboardStats, getRecentOrders, addWalletRequest, getAdminDashboard, getAdminSummary, getMonthlyAnalytics, getWeeklyAnalytics } from '../controller/dashboard.controller.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Admin dashboard route
router.get('/admin', authenticateToken, requireAdmin, getAdminDashboard);

// Admin reports routes
router.get('/admin/summary', authenticateToken, requireAdmin, getAdminSummary);
router.get('/admin/monthly/:userId', authenticateToken, requireAdmin, getMonthlyAnalytics);
router.get('/admin/weekly/:userId', authenticateToken, requireAdmin, getWeeklyAnalytics);

// User dashboard routes
router.get('/stats/:userId', authenticateToken, getDashboardStats);
router.get('/recent-orders/:userId', authenticateToken, getRecentOrders);
router.post('/wallet-request', authenticateToken, addWalletRequest);

export default router;