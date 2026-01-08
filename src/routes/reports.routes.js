import express from 'express';
import * as ReportController from '../controller/report.controller.js';
    import { cacheMiddleware } from '../middlewares/cache.middleware.js';

const router = express.Router();

router.post('/generate', ReportController.generate);
router.get('/', cacheMiddleware, ReportController.getAll);

export default router;