import { create } from 'zustand';
import type { Step, ConversationRound, DiagnosisScore, WeakPoint, TrainingDay, MonthlyGoal, LearningMaterial, UserRole } from '../types';
import { login as apiLogin, logout as apiLogout, getMe } from '../api/auth';

interface User {
  id: string;
  name: string;
  role: UserRole;
  employeeId: string;
  avatar?: string;
  email?: string;
}

interface AppState {
  user: User | null;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  currentStep: Step;
  currentRecordId: string | null;
  uploadProgress: number;
  analysisComplete: boolean;
  conversation: ConversationRound[];
  currentConversationIndex: number;
  diagnosisScore: DiagnosisScore;
  weakPoints: WeakPoint[];
  trainingPlan: {
    weekly: TrainingDay[];
    monthly: MonthlyGoal[];
    materials: LearningMaterial[];
    examDate: string;
  };
  learningFilters: {
    knowledgeLine: string;
    knowledgeCat: string;
    allCategories: string[];
  };
  setLearningFilters: (filters: Partial<AppState['learningFilters']>) => void;
  login: (username: string, password: string) => Promise<UserRole | null>;
  logout: () => void;
  restoreSession: () => Promise<void>;
  setStep: (step: Step) => void;
  setCurrentRecordId: (id: string | null) => void;
  setUploadProgress: (progress: number) => void;
  setAnalysisComplete: (complete: boolean) => void;
  addConversationReply: (reply: string) => void;
  advanceConversation: () => void;
  resetConversation: () => void;
}

const mockConversation: ConversationRound[] = [
  { round: 1, customer: '你们比X牌贵20%，凭什么？', difficulty: '中等', expected: '使用价格锚点话术，提供量化证据' },
  { round: 2, customer: '那如果我用三年就换呢？还能省吗？', difficulty: '困难', expected: '灵活切换场景，计算不同周期的TCO' },
  { round: 3, customer: '你们售后响应速度怎么样？', difficulty: '简单', expected: '给出具体服务承诺时长' },
  { round: 4, customer: '我还是担心 upfront cost 太高。', difficulty: '中等', expected: '拆分成本，强调 ROI' },
  { round: 5, customer: '好，我先报给领导看看。', difficulty: '简单', expected: '主动推进，约定下次沟通时间' },
];

const mockTrainingPlan = {
  weekly: [
    { day: '周一', title: '价格异议四步法 · 理论学习', description: '微课视频 12分钟 · 话术卡背诵', type: 'video' as const, duration: '12分钟' },
    { day: '周二', title: '竞品价格对比场景 · 模拟练习', description: 'AI对话 3轮 · 预计 15分钟', type: 'practice' as const, duration: '15分钟' },
    { day: '周三', title: '产品规格记忆 · 速记测试', description: '在线测试 10分钟 · 目标正确率100%', type: 'test' as const, duration: '10分钟' },
    { day: '周四', title: '语速与停顿控制 · 录音纠偏', description: '跟读优秀录音 8分钟 · 自主录音 5分钟', type: 'recording' as const, duration: '13分钟' },
    { day: '周五', title: '综合模拟考核', description: '完整产品介绍 + AI客户对话 5轮', type: 'exam' as const, duration: '25分钟' },
  ],
  monthly: [
    { week: 1, title: '攻克价格异议处理', target: '价格异议场景得分 ≥ 80分' },
    { week: 2, title: '夯实产品规格知识', target: '数据准确率达到 100%' },
    { week: 3, title: '提升表达流畅度', target: '填充词占比 ≤ 3%，语速控制在 150—200字/分钟' },
    { week: 4, title: '综合演练与期末考核', target: '综合得分 ≥ 85分' },
  ],
  materials: [
    { id: '1', title: '微课：价格异议四步法', type: 'video' as const, duration: '12分钟' },
    { id: '2', title: '话术卡：总拥有成本对比法', type: 'pdf' as const, duration: '2页' },
    { id: '3', title: '优秀录音：李四分单案例', type: 'audio' as const, duration: '8分钟' },
    { id: '4', title: '产品规格速记手册', type: 'article' as const, duration: '5分钟阅读' },
  ],
  examDate: '4月25日',
};

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isAuthLoading: true,
  currentStep: 1,
  currentRecordId: null,
  uploadProgress: 0,
  analysisComplete: false,
  conversation: mockConversation,
  currentConversationIndex: 0,
  diagnosisScore: {
    knowledgeCoverage: 72,
    coreHitRate: 55,
    dataAccuracy: 80,
    scriptMatch: 68,
    structureScore: 85,
    fluencyScore: 72,
  },
  weakPoints: [
    { id: '1', name: '异议处理（价格对比场景）', score: 58, maxScore: 100, description: '缺少量化证据和价格锚点话术，未能将客户注意力从"单价"转移到"总拥有成本"。', severity: 'high' },
    { id: '2', name: '产品知识（规格数据）', score: 65, maxScore: 100, description: '03:22 处提到规格"4.2kg"，知识库标准值为"3.2kg"。', severity: 'medium' },
    { id: '3', name: '表达流畅度', score: 72, maxScore: 100, description: '填充词（嗯/啊/那个）占比 6.2%，语速偏快（268字/分钟）。', severity: 'low' },
  ],
  trainingPlan: mockTrainingPlan,
  learningFilters: { knowledgeLine: '', knowledgeCat: '', allCategories: [] },
  setLearningFilters: (filters) => set((state) => ({ learningFilters: { ...state.learningFilters, ...filters } })),
  login: async (username, password) => {
    const res = await apiLogin(username.trim(), password);
    if (res.code !== 0 || !res.data) {
      return null;
    }
    const apiUser = res.data;
    const user: User = {
      id: apiUser.user_id,
      name: apiUser.name,
      role: apiUser.role,
      employeeId: apiUser.employee_id || '',
      avatar: apiUser.avatar_url,
      email: apiUser.email,
    };
    set({ user, isAuthenticated: true, currentStep: 1, currentRecordId: null });
    return apiUser.role;
  },
  logout: () => {
    apiLogout();
    set({ user: null, isAuthenticated: false, currentStep: 1, currentRecordId: null });
  },
  restoreSession: async () => {
    set({ isAuthLoading: true });
    try {
      const res = await getMe();
      if (res.code === 0 && res.data) {
        const apiUser = res.data;
        const user: User = {
          id: apiUser.user_id,
          name: apiUser.name,
          role: apiUser.role,
          employeeId: apiUser.employee_id || '',
          avatar: apiUser.avatar_url,
          email: apiUser.email,
        };
        set({ user, isAuthenticated: true });
      } else {
        apiLogout();
        set({ user: null, isAuthenticated: false });
      }
    } catch {
      apiLogout();
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isAuthLoading: false });
    }
  },
  setStep: (step) => set({ currentStep: step }),
  setCurrentRecordId: (id) => set({ currentRecordId: id }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),
  setAnalysisComplete: (complete) => set({ analysisComplete: complete }),
  addConversationReply: (reply) => {
    const state = get();
    const updated = [...state.conversation];
    updated[state.currentConversationIndex] = {
      ...updated[state.currentConversationIndex],
      salesReply: reply,
      score: Math.floor(Math.random() * 20) + 75,
      feedback: '应答逻辑清晰，可继续提升',
    };
    set({ conversation: updated });
  },
  advanceConversation: () => {
    const state = get();
    if (state.currentConversationIndex < state.conversation.length - 1) {
      set({ currentConversationIndex: state.currentConversationIndex + 1 });
    }
  },
  resetConversation: () => set({ currentConversationIndex: 0 }),
}));
