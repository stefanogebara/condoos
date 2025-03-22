import { Request, Response } from 'express';
import { ProjectService } from '../services/project.service';
import { NotificationService } from '../services/notification.service';
import { CreateProjectDTO, UpdateProjectStatusDTO, AddVoteDTO, AddCommentDTO } from '../types/project';

export class ProjectController {
  static async createProject(req: Request, res: Response) {
    try {
      const { title, description, estimatedCost, condominiumId } = req.body as CreateProjectDTO;
      const userId = req.user!.userId;

      // Validate input
      if (!title || !description || !estimatedCost || !condominiumId) {
        return res.status(400).json({ message: 'All fields are required' });
      }

      const project = await ProjectService.createProject(
        title,
        description,
        estimatedCost,
        condominiumId,
        userId
      );

      res.status(201).json({
        message: 'Project created successfully',
        project
      });
    } catch (error) {
      console.error('Error creating project:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async getProjects(req: Request, res: Response) {
    try {
      const condominiumId = parseInt(req.params.condominiumId);
      if (isNaN(condominiumId)) {
        return res.status(400).json({ message: 'Invalid condominium ID' });
      }

      const projects = await ProjectService.getProjectsByCondominium(condominiumId);
      res.json(projects);
    } catch (error) {
      console.error('Error fetching projects:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async getProjectById(req: Request, res: Response) {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        return res.status(400).json({ message: 'Invalid project ID' });
      }

      const project = await ProjectService.getProjectById(projectId);
      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }

      const comments = await ProjectService.getProjectComments(projectId);
      const userVote = await ProjectService.getUserVote(projectId, req.user!.userId);

      res.json({
        project,
        comments,
        userVote
      });
    } catch (error) {
      console.error('Error fetching project:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async updateProjectStatus(req: Request, res: Response) {
    try {
      const projectId = parseInt(req.params.projectId);
      const { status } = req.body as UpdateProjectStatusDTO;

      if (isNaN(projectId)) {
        return res.status(400).json({ message: 'Invalid project ID' });
      }

      if (!status) {
        return res.status(400).json({ message: 'Status is required' });
      }

      const project = await ProjectService.updateProjectStatus(projectId, status);
      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }

      // Send notifications about status change
      await NotificationService.notifyProjectStatusChange(project, status);

      res.json({
        message: 'Project status updated successfully',
        project
      });
    } catch (error) {
      console.error('Error updating project status:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async vote(req: Request, res: Response) {
    try {
      const projectId = parseInt(req.params.projectId);
      const { vote } = req.body as AddVoteDTO;
      const userId = req.user!.userId;

      if (isNaN(projectId)) {
        return res.status(400).json({ message: 'Invalid project ID' });
      }

      if (typeof vote !== 'boolean') {
        return res.status(400).json({ message: 'Vote must be true or false' });
      }

      const project = await ProjectService.getProjectById(projectId);
      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }

      if (project.status !== 'voting') {
        return res.status(400).json({ message: 'Project is not in voting status' });
      }

      await ProjectService.addVote(projectId, userId, vote);
      
      // Send notifications about new vote
      await NotificationService.notifyNewVote(project, userId, vote);
      
      const updatedProject = await ProjectService.getProjectById(projectId);

      res.json({
        message: 'Vote recorded successfully',
        project: updatedProject
      });
    } catch (error) {
      console.error('Error recording vote:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async addComment(req: Request, res: Response) {
    try {
      const projectId = parseInt(req.params.projectId);
      const { content } = req.body as AddCommentDTO;
      const userId = req.user!.userId;

      if (isNaN(projectId)) {
        return res.status(400).json({ message: 'Invalid project ID' });
      }

      if (!content || !content.trim()) {
        return res.status(400).json({ message: 'Comment content is required' });
      }

      const project = await ProjectService.getProjectById(projectId);
      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }

      const comment = await ProjectService.addComment(projectId, userId, content);
      
      // Send notifications about new comment
      await NotificationService.notifyNewComment(project, userId);

      res.status(201).json({
        message: 'Comment added successfully',
        comment
      });
    } catch (error) {
      console.error('Error adding comment:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
} 