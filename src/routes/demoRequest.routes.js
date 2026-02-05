import express from 'express';
import * as DemoRequestController from '../controller/demoRequest.controller.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/', DemoRequestController.createDemoRequest);
router.get('/', authenticateToken, requireAdmin, DemoRequestController.getAllDemoRequests);
router.patch('/:id/status', authenticateToken, requireAdmin, DemoRequestController.updateDemoRequestStatus);
router.patch('/:id', authenticateToken, requireAdmin, DemoRequestController.updateDemoRequest);

export default router;
