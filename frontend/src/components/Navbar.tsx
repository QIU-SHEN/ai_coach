import { useState } from 'react';
import { LogOut, UserCircle, Briefcase, Shield, KeyRound, ChevronDown, Mail } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { changePassword, updateEmail } from '../api/auth';

const roleLabel: Record<string, string> = {
  employee: '销售员工',
  manager: '销售主管',
  admin: '系统管理员',
};

const roleIcon: Record<string, React.ReactNode> = {
  employee: <UserCircle className="w-5 h-5" />,
  manager: <Briefcase className="w-5 h-5" />,
  admin: <Shield className="w-5 h-5" />,
};

export function Navbar() {
  const { user, logout } = useAppStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  if (!user) return null;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError('');
    if (newPassword.length < 6) {
      setPwdError('新密码长度不能少于 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('两次输入的新密码不一致');
      return;
    }
    setPwdLoading(true);
    try {
      const res = await changePassword(oldPassword, newPassword);
      if (res.code === 0) {
        setShowPwdModal(false);
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        alert('密码修改成功，请重新登录');
        logout();
        window.location.href = '/login';
      } else {
        setPwdError(res.message || '修改失败');
      }
    } catch (err: any) {
      setPwdError(err.message || '修改失败');
    } finally {
      setPwdLoading(false);
    }
  };

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailValue)) {
      setEmailError('邮箱格式不正确');
      return;
    }
    setEmailLoading(true);
    try {
      const res = await updateEmail(emailValue.trim());
      if (res.code === 0) {
        setShowEmailModal(false);
        setEmailValue('');
        alert('邮箱修改成功');
        // 刷新页面以更新 user 状态中的 email（或调用 restoreSession）
        window.location.reload();
      } else {
        setEmailError(res.message || '修改失败');
      }
    } catch (err: any) {
      setEmailError(err.message || '修改失败');
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <>
      <nav className="bg-white shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shrink-0">AI</div>
              <span className="font-bold text-gray-900 text-base md:text-lg truncate">销售能力诊断陪练</span>
            </div>

            <div className="flex items-center gap-2 md:gap-4">
              <div
                className="relative"
                onMouseEnter={() => setDropdownOpen(true)}
                onMouseLeave={() => setDropdownOpen(false)}
              >
                <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1.5 bg-gray-100 rounded-lg cursor-pointer select-none hover:bg-gray-200 transition-colors">
                  <span className="text-gray-500">{roleIcon[user.role]}</span>
                  <div className="text-sm hidden md:block">
                    <span className="font-medium text-gray-900">{user.name}</span>
                    <span className="text-gray-500 ml-2 text-xs">{roleLabel[user.role]}</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                </div>

                {dropdownOpen && (
                  <div className="absolute top-full right-0 w-40 bg-white rounded-b-lg rounded-tl-lg shadow-lg border py-1 z-50">
                    <div className="px-4 py-2 text-xs text-gray-500 border-b md:hidden">
                      {user.name} · {roleLabel[user.role]}
                    </div>
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        setShowPwdModal(true);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <KeyRound className="w-4 h-4" />
                      修改密码
                    </button>
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        setEmailValue(user.email || '');
                        setShowEmailModal(true);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Mail className="w-4 h-4" />
                      修改邮箱
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={logout}
                className="flex items-center gap-1 px-2 md:px-3 py-1.5 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden md:inline">退出</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {showPwdModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">修改密码</h3>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">旧密码</label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请输入旧密码"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="至少 6 位"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">确认新密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="再次输入新密码"
                />
              </div>
              {pwdError && <p className="text-sm text-red-600">{pwdError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowPwdModal(false);
                    setPwdError('');
                    setOldPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                  }}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={pwdLoading}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {pwdLoading ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEmailModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">修改邮箱</h3>
            <form onSubmit={handleUpdateEmail} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">邮箱地址</label>
                <input
                  type="email"
                  value={emailValue}
                  onChange={(e) => setEmailValue(e.target.value)}
                  required
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请输入邮箱"
                />
              </div>
              {emailError && <p className="text-sm text-red-600">{emailError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEmailModal(false);
                    setEmailError('');
                    setEmailValue('');
                  }}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={emailLoading}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {emailLoading ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
