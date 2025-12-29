import express from 'express';
import * as TemplateController from '../controller/template.controller.js';
import { authenticateToken, requireUser } from '../middlewares/auth.middleware.js';

const router = express.Router();

// All template routes require authentication
router.use(authenticateToken);
router.use(requireUser);

router.post('/', TemplateController.create);
router.get('/', TemplateController.getAll);
router.get('/user/:userId', TemplateController.getAll); // User-specific templates
router.get('/type/:type', TemplateController.getByType);
router.get('/:id', TemplateController.getById);
router.put('/:id', TemplateController.update);
router.delete('/:id', TemplateController.deleteTemplate);
router.post('/:id/approve', TemplateController.approve);

export default router;
