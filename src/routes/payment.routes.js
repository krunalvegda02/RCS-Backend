import express from 'express';
import * as PaymentController from '../controller/payment.controller.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Protected routes (require authentication)
router.post('/create-order', authenticateToken, PaymentController.createOrder);
router.post('/verify', authenticateToken, PaymentController.verifyPayment);
router.get('/history', authenticateToken, PaymentController.getPaymentHistory);

router.get('/invoice/:orderId', authenticateToken, PaymentController.downloadInvoice);
router.get('/:orderId', authenticateToken, PaymentController.getPaymentDetails);

// Admin routes
router.get('/admin/all', authenticateToken, requireAdmin, PaymentController.getAllPayments);

// Webhook route (no authentication - verified by signature)
router.post('/webhook', PaymentController.handleWebhook);

export default router;
