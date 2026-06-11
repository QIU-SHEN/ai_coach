export type UserRole = 'employee' | 'manager' | 'admin';

export type Step = 1 | 2 | 3 | 4 | 5;

export type Difficulty = '简单' | '中等' | '困难';

export interface User {
  id: string;
  name: string;
  role: UserRole;
  employeeId: string;
  avatar?: string;
}

export interface ConversationRound {
  round: number;
  customer: string;
  difficulty: Difficulty;
  expected: string;
  salesReply?: string;
  score?: number;
  feedback?: string;
}

export interface DiagnosisScore {
  knowledgeCoverage: number;
  coreHitRate: number;
  dataAccuracy: number;
  scriptMatch: number;
  structureScore: number;
  fluencyScore: number;
}

export interface WeakPoint {
  id: string;
  name: string;
  score: number;
  maxScore: number;
  description: string;
  timestamp?: string;
  severity: 'high' | 'medium' | 'low';
}

export interface TrainingDay {
  day: string;
  title: string;
  description: string;
  type: 'video' | 'practice' | 'test' | 'recording' | 'exam';
  duration: string;
}

export interface MonthlyGoal {
  week: number;
  title: string;
  target: string;
}

export interface LearningMaterial {
  id: string;
  title: string;
  type: 'video' | 'pdf' | 'audio' | 'article';
  duration: string;
}

export interface TeamMember {
  id: string;
  name: string;
  employeeId: string;
  score: number;
  weakPoints: string[];
  practiceTime: string;
  status: 'pending' | 'reviewed' | 'archived';
}
