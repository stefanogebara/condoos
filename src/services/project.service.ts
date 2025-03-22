import { Pool, QueryResult } from 'pg';
import { pool } from '../db/pool';
import { Project, ProjectStatus, ProjectVote, ProjectComment } from '../types/project';

interface ProjectRow {
  id: number;
  title: string;
  description: string;
  estimated_cost: string;
  status: ProjectStatus;
  condominium_id: number;
  creator_id: number;
  created_at: Date;
  updated_at: Date;
  yes_votes?: string;
  no_votes?: string;
}

interface ProjectVoteRow {
  project_id: number;
  user_id: number;
  vote: boolean;
  created_at: Date;
}

interface ProjectCommentRow {
  id: number;
  project_id: number;
  user_id: number;
  content: string;
  created_at: Date;
  first_name: string;
  last_name: string;
}

export class ProjectService {
  static async createProject(
    title: string,
    description: string,
    estimatedCost: number,
    condominiumId: number,
    creatorId: number
  ): Promise<Project> {
    const result = await pool.query<ProjectRow>(
      `INSERT INTO projects (title, description, estimated_cost, condominium_id, creator_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, description, estimatedCost, condominiumId, creatorId]
    );

    return this.transformProject(result.rows[0]);
  }

  static async getProjectsByCondominium(condominiumId: number): Promise<Project[]> {
    const result = await pool.query<ProjectRow>(
      `SELECT p.*, 
              COUNT(CASE WHEN pv.vote = true THEN 1 END) as yes_votes,
              COUNT(CASE WHEN pv.vote = false THEN 1 END) as no_votes
       FROM projects p
       LEFT JOIN project_votes pv ON p.id = pv.project_id
       WHERE p.condominium_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [condominiumId]
    );

    return result.rows.map((row: ProjectRow) => ({
      ...this.transformProject(row),
      votes: {
        yes: parseInt(row.yes_votes || '0'),
        no: parseInt(row.no_votes || '0')
      }
    }));
  }

  static async getProjectById(projectId: number): Promise<Project | null> {
    const result = await pool.query<ProjectRow>(
      `SELECT p.*, 
              COUNT(CASE WHEN pv.vote = true THEN 1 END) as yes_votes,
              COUNT(CASE WHEN pv.vote = false THEN 1 END) as no_votes
       FROM projects p
       LEFT JOIN project_votes pv ON p.id = pv.project_id
       WHERE p.id = $1
       GROUP BY p.id`,
      [projectId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      ...this.transformProject(row),
      votes: {
        yes: parseInt(row.yes_votes || '0'),
        no: parseInt(row.no_votes || '0')
      }
    };
  }

  static async updateProjectStatus(
    projectId: number,
    status: ProjectStatus
  ): Promise<Project | null> {
    const result = await pool.query<ProjectRow>(
      `UPDATE projects
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [status, projectId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.transformProject(result.rows[0]);
  }

  static async addVote(
    projectId: number,
    userId: number,
    vote: boolean
  ): Promise<ProjectVote> {
    const result = await pool.query<ProjectVoteRow>(
      `INSERT INTO project_votes (project_id, user_id, vote)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id)
       DO UPDATE SET vote = $3, created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [projectId, userId, vote]
    );

    return {
      projectId: result.rows[0].project_id,
      userId: result.rows[0].user_id,
      vote: result.rows[0].vote,
      createdAt: result.rows[0].created_at
    };
  }

  static async getUserVote(
    projectId: number,
    userId: number
  ): Promise<boolean | null> {
    const result = await pool.query<{ vote: boolean }>(
      `SELECT vote FROM project_votes
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    );

    return result.rows.length > 0 ? result.rows[0].vote : null;
  }

  static async addComment(
    projectId: number,
    userId: number,
    content: string
  ): Promise<ProjectComment> {
    const result = await pool.query<ProjectCommentRow>(
      `INSERT INTO project_comments (project_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING *, 
       (SELECT first_name FROM users WHERE id = $2) as first_name,
       (SELECT last_name FROM users WHERE id = $2) as last_name`,
      [projectId, userId, content]
    );

    return {
      id: result.rows[0].id,
      projectId: result.rows[0].project_id,
      userId: result.rows[0].user_id,
      content: result.rows[0].content,
      createdAt: result.rows[0].created_at,
      user: {
        firstName: result.rows[0].first_name,
        lastName: result.rows[0].last_name
      }
    };
  }

  static async getProjectComments(projectId: number): Promise<ProjectComment[]> {
    const result = await pool.query<ProjectCommentRow>(
      `SELECT pc.*, u.first_name, u.last_name
       FROM project_comments pc
       JOIN users u ON pc.user_id = u.id
       WHERE pc.project_id = $1
       ORDER BY pc.created_at DESC`,
      [projectId]
    );

    return result.rows.map((row: ProjectCommentRow) => ({
      id: row.id,
      projectId: row.project_id,
      userId: row.user_id,
      content: row.content,
      createdAt: row.created_at,
      user: {
        firstName: row.first_name,
        lastName: row.last_name
      }
    }));
  }

  private static transformProject(row: ProjectRow): Project {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      estimatedCost: parseFloat(row.estimated_cost),
      status: row.status,
      condominiumId: row.condominium_id,
      creatorId: row.creator_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
} 