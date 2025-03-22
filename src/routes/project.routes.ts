import { Router } from 'express';
import { ProjectController } from '../controllers/project.controller';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// Create project (all authenticated users can create projects)
router.post('/', authenticateToken, ProjectController.createProject);

// Get projects for a condominium
router.get('/condominium/:condominiumId', authenticateToken, ProjectController.getProjects);

// Get specific project
router.get('/:projectId', authenticateToken, ProjectController.getProjectById);

// Update project status (admin only)
router.patch(
  '/:projectId/status',
  authenticateToken,
  requireRole(['admin', 'super_admin']),
  ProjectController.updateProjectStatus
);

// Vote on a project
router.post('/:projectId/vote', authenticateToken, ProjectController.vote);

// Add comment to a project
router.post('/:projectId/comments', authenticateToken, ProjectController.addComment);

export default router; 