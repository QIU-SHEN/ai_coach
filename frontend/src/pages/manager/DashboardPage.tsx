import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LineChart, Line, CartesianGrid, Tooltip } from 'recharts';

const barData = [
  { name: '产品知识', score: 78 },
  { name: '话术熟练度', score: 74 },
  { name: '异议处理', score: 62 },
  { name: '逻辑结构', score: 81 },
  { name: '表达流畅度', score: 76 },
];

const lineData = [
  { date: '3/18', score: 68 },
  { date: '3/25', score: 70.5 },
  { date: '4/1', score: 72 },
  { date: '4/8', score: 74.2 },
  { date: '4/16', score: 75.7 },
];

export function DashboardPage() {
  return (
    <div className="fade-in space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <p className="text-sm text-gray-500">团队平均分</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">75.7</p>
          <p className="text-xs text-green-600 mt-1">↑ 较上月 +4.2%</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <p className="text-sm text-gray-500">本周练习次数</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">42</p>
          <p className="text-xs text-gray-400 mt-1">人均 2.1 次</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <p className="text-sm text-gray-500">Top 1 薄弱点</p>
          <p className="text-xl font-bold text-red-600 mt-1">异议处理</p>
          <p className="text-xs text-gray-400 mt-1">占比 38%</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <p className="text-sm text-gray-500">计划完成率</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">68%</p>
          <p className="text-xs text-yellow-600 mt-1">↓ 低于目标 2%</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="font-bold text-gray-900 mb-4">各维度得分分布</h3>
          <div className="relative h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="score" fill="rgba(59,130,246,0.8)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="font-bold text-gray-900 mb-4">团队得分变化趋势（近30天）</h3>
          <div className="relative h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis domain={[50, 90]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} fill="rgba(37,99,235,0.1)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
