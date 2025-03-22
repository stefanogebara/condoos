export type ProjectStatus = 'proposed' | 'voting' | 'approved' | 'in_progress' | 'completed' | 'rejected';

export interface Project {
  id: number;
  title: string;
  description: string;
  estimatedCost: number;
  status: ProjectStatus;
  condominiumId: number;
  creatorId: number;
  createdAt: Date;
  updatedAt: Date;
  votes?: {
    yes: number;
    no: number;
  };
}

export interface ProjectVote {
  projectId: number;
  userId: number;
  vote: boolean;
  createdAt: Date;
}

export interface ProjectComment {
  id: number;
  projectId: number;
  userId: number;
  content: string;
  createdAt: Date;
  user?: {
    firstName: string;
    lastName: string;
  };
}

export interface CreateProjectDTO {
  title: string;
  description: string;
  estimatedCost: number;
  condominiumId: number;
}

export interface UpdateProjectStatusDTO {
  status: ProjectStatus;
}

export interface AddVoteDTO {
  vote: boolean;
}

export interface AddCommentDTO {
  content: string;
} 