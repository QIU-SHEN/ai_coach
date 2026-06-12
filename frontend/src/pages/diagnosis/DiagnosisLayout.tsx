import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { FileBarChart, MessageSquare, ClipboardList } from 'lucide-react';

type TabKey = 'assessment' | 'simulation' | 'debrief';

interface TabItem {
  key: TabKey;
  label: string;
  icon: typeof FileBarChart;
  path: string;
}

const tabs: TabItem[] = [
  { key: 'assessment', label: '能力评估模块', icon: FileBarChart, path: '/employee/diagnosis/assessment' },
  { key: 'simulation', label: '情景模拟对话', icon: MessageSquare, path: '/employee/diagnosis/simulation' },
  { key: 'debrief', label: '复盘中心', icon: ClipboardList, path: '/employee/diagnosis/debrief' },
];

function getTabFromPath(pathname: string): TabKey {
  if (pathname.includes('/simulation')) return 'simulation';
  if (pathname.includes('/debrief')) return 'debrief';
  return 'assessment';
}

export function DiagnosisLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = getTabFromPath(location.pathname);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Tab 导航 */}
      <div className="bg-white border-b border-gray-200 px-6 pt-4 pb-0 sticky top-0 z-10">
        <div className="flex gap-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => navigate(tab.path)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                  isActive
                    ? 'text-blue-700 border-blue-600'
                    : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
