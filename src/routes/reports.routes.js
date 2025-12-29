import express from 'express';
import * as ReportController from '../controller/report.controller.js';

const router = express.Router();

router.post('/generate', ReportController.generate);
router.get('/', ReportController.getAll);

export default router;