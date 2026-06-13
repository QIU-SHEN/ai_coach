import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase,
  Users,
  Monitor,
  FileText,
  ClipboardList,
  Play,
  Loader2,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { ProductLineSelector } from '../../components/ProductLineSelector';
import { createDebrief } from '../../api/debrief';

// ── 角色定义 ──
interface CustomerRole {
  id: string;
  name: string;
  icon: typeof Briefcase;
  emoji: string;
  description: string;
  concerns: string[];
}

const customerRoles: CustomerRole[] = [
  {
    id: 'decision_maker',
    name: '决策者',
    icon: Briefcase,
    emoji: '👔',
    description: '高层，关注 ROI 和战略价值',
    concerns: ['收益', '成本', '竞品对比'],
  },
  {
    id: 'user',
    name: '使用者',
    icon: Users,
    emoji: '👷',
    description: '一线员工，关注易用性和效率',
    concerns: ['操作便捷', '培训成本', '效率提升'],
  },
  {
    id: 'technical',
    name: '技术顾问',
    icon: Monitor,
    emoji: '💻',
    description: 'IT/技术负责人，关注技术细节',
    concerns: ['技术架构', '安全性', '集成'],
  },
  {
    id: 'procurement',
    name: '采购',
    icon: FileText,
    emoji: '📝',
    description: '采购部门，关注价格和合同条款',
    concerns: ['价格', '账期', '售后'],
  },
  {
    id: 'admin',
    name: '行政',
    icon: ClipboardList,
    emoji: '📋',
    description: '行政人员，关注流程合规',
    concerns: ['合规', '流程', '审批'],
  },
];

// ── 采购状态 ──
interface PurchaseStatus {
  id: string;
  name: string;
  emoji: string;
  description: string;
  color: string;
}

const purchaseStatuses: PurchaseStatus[] = [
  { id: 'observing', name: '观望', emoji: '🟡', description: '客户犹豫不决，需要更多说服', color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  { id: 'comparing', name: '对比', emoji: '🔵', description: '客户正在对比多家供应商', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'urgent', name: '急迫', emoji: '🔴', description: '客户有明确需求，希望快速推进', color: 'bg-red-50 text-red-700 border-red-200' },
];

export function SimulationPage() {
  const navigate = useNavigate();
  const [selectedRole, setSelectedRole] = useState<string>('decision_maker');
  const [selectedStatus, setSelectedStatus] = useState<string>('observing');
  const [productLineId, setProductLineId] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [simulationName, setSimulationName] = useState('');
  const [starting, setStarting] = useState(false);

  const handleStartSimulation = async () => {
    if (starting) return;
    setStarting(true);
    try {
      // 创建一个模拟对话记录
      const roleName = customerRoles.find(r => r.id === selectedRole)?.name || '客户';
      const statusName = purchaseStatuses.find(s => s.id === selectedStatus)?.name || '';
      const title = simulationName.trim() || `情景模拟：${roleName}（${statusName}）`;

      const res = await createDebrief(title, '', productLineId || undefined, undefined, 'simulation');
      if (res.code === 0 && res.data) {
        navigate(`/employee/diagnosis/simulation/${res.data.record_id}/chat`, {
          state: {
            role: selectedRole,
            status: selectedStatus,
            difficulty,
            productLineId,
          },
        });
      } else {
        alert('创建模拟对话失败，请重试');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '创建失败');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* 角色选择 */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4">选择客户角色</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {customerRoles.map((role) => (
            <button
              key={role.id}
              onClick={() => setSelectedRole(role.id)}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                selectedRole === role.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="text-2xl mb-2">{role.emoji}</div>
              <div className="font-semibold text-gray-900 text-sm mb-1">{role.name}</div>
              <div className="text-xs text-gray-500">{role.description}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 场景配置 */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4">设置采购状态</h2>
        <div className="grid grid-cols-3 gap-4">
          {purchaseStatuses.map((status) => (
            <button
              key={status.id}
              onClick={() => setSelectedStatus(status.id)}
              className={`p-4 rounded-xl border-2 text-center transition-all ${
                selectedStatus === status.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="text-2xl mb-2">{status.emoji}</div>
              <div className="font-semibold text-gray-900 text-sm mb-1">{status.name}</div>
              <div className="text-xs text-gray-500">{status.description}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 其他配置 */}
      <Card className="p-6">
        <div className="grid md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">产品线</label>
            <ProductLineSelector
              value={productLineId}
              onChange={(id) => setProductLineId(id)}
              placeholder="选择产品线"
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">难度</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="easy">简单</option>
              <option value="medium">中等</option>
              <option value="hard">困难</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleStartSimulation}
              disabled={starting}
              className="w-full flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {starting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  创建中...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  开始模拟对话
                </>
              )}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
