export type UserRole = 'super_admin' | 'admin' | 'resident';
export type ProjectStatus = 'proposed' | 'voting' | 'approved' | 'in_progress' | 'completed' | 'rejected';

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface Condominium {
  id: number;
  name: string;
  address: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: number;
  condominiumId: number;
  title: string;
  description: string;
  status: ProjectStatus;
  estimatedCost: number;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Vote {
  id: number;
  projectId: number;
  userId: number;
  voteValue: boolean;
  createdAt: Date;
}

export interface Comment {
  id: number;
  projectId: number;
  userId: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectUpdate {
  id: number;
  projectId: number;
  title: string;
  description: string;
  createdBy: number;
  createdAt: Date;
} 