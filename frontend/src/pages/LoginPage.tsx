import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { Sparkles } from 'lucide-react';

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAppStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }
    if (password.length < 6) {
      setError('密码长度不能少于6位');
      return;
    }

    setIsLoading(true);
    try {
      const role = await login(username.trim(), password);
      if (role) {
        if (role === 'employee') navigate('/employee/home', { replace: true });
        else if (role === 'manager') navigate('/manager/team', { replace: true });
        else navigate('/admin/knowledge', { replace: true });
      } else {
        setError('用户名或密码错误');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex">
      {/* 左侧品牌区 — 大屏显示 */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-5/12 bg-gradient-to-br from-blue-700 to-blue-900 text-white flex-col justify-between p-12 relative overflow-hidden">
        {/* 装饰圆 */}
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-white/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-white/5 rounded-full blur-3xl"></div>

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold">AI 销售陪练</span>
          </div>
        </div>

        <div className="relative z-10 space-y-6">
          <h2 className="text-3xl font-bold leading-tight">
            数据驱动的
            <br />
            销售能力诊断平台
          </h2>
          <p className="text-blue-100 text-lg leading-relaxed max-w-sm">
            通过 AI 复盘每一次客户沟通，精准识别能力短板，让每位销售都能持续成长。
          </p>
        </div>

        <div className="relative z-10 text-sm text-blue-200">
          © 2026 AI 销售陪练系统
        </div>
      </div>

      {/* 右侧表单区 */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-gray-50">
        <div className="w-full max-w-sm">
          {/* 小屏品牌标识 */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">AI 销售陪练</span>
          </div>

          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
            <div className="mb-6">
              <h1 className="text-xl font-bold text-gray-900">欢迎回来</h1>
              <p className="text-gray-500 text-sm mt-1">请输入账号密码登录系统</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">用户名</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-gray-300"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">密码</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-gray-300"
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-100">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-sm"
              >
                {isLoading ? '登录中...' : '登录'}
              </button>

              <div className="flex items-center justify-between">
                <div></div>
                <Link to="/forgot-password" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                  忘记密码？
                </Link>
              </div>
            </form>

            <div className="mt-6 pt-5 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-3">演示账号</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { role: '员工', account: 'zhangsan' },
                  { role: '主管', account: 'lisi' },
                  { role: '管理员', account: 'wangwu' },
                ].map((item) => (
                  <div
                    key={item.account}
                    className="text-center p-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => {
                      setUsername(item.account);
                      setPassword('123456');
                    }}
                  >
                    <p className="text-xs font-medium text-gray-700">{item.role}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{item.account}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
