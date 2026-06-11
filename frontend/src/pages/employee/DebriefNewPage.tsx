import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Mic, Square, Loader2, Send, Upload, MessageSquare, PhoneCall } from 'lucide-react';
import { createDebrief, type DebriefMode } from '../../api/debrief';
import { ProductLineSelector } from '../../components/ProductLineSelector';
import { IFlytekAsrClient } from '../../utils/iflytek-asr';

export function DebriefNewPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<DebriefMode>('post_meeting');
  const [title, setTitle] = useState('');
  const [productLineId, setProductLineId] = useState('');
  const [content, setContent] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // 讯飞实时转写客户端引用
  const asrClientRef = useRef<IFlytekAsrClient | null>(null);

  // --- 原有的本地录音逻辑（保留用于 call_recording 模式） ---
  const startLocalRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], 'recording.webm', { type: 'audio/webm' });
        setAudioFile(file);
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start();
      setRecording(true);
    } catch {
      setError('无法访问麦克风，请检查权限');
    }
  };

  const stopLocalRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  // --- 讯飞实时转写逻辑（post_meeting 模式使用） ---
  const asrFinalRef = useRef('');

  const startRealtimeAsr = useCallback(async () => {
    asrFinalRef.current = content;

    const client = new IFlytekAsrClient({
      onText: (final, interim, _isFinal) => {
        setContent(asrFinalRef.current + final + (interim ? ' ' + interim : ''));
      },
      onError: (err) => {
        setError(err);
        setRecording(false);
      },
      onStatusChange: (status) => {
        if (status === 'recording') {
          setRecording(true);
        } else if (status === 'idle') {
          setRecording(false);
        }
      },
    });

    asrClientRef.current = client;
    await client.start();
  }, [content]);

  const stopRealtimeAsr = useCallback(() => {
    asrClientRef.current?.stop();
    asrClientRef.current = null;
    setRecording(false);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setAudioFile(e.target.files[0]);
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError(mode === 'post_meeting' ? '请填写见客主题' : '请填写客户名称 / 拜访主题');
      return;
    }
    if (mode === 'post_meeting' && !content.trim() && !audioFile) {
      setError('请填写文字描述或上传语音');
      return;
    }
    if (mode === 'call_recording' && !productLineId) {
      setError('请选择产品线');
      return;
    }
    if (mode === 'call_recording' && !audioFile) {
      setError('请上传对话录音文件');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await createDebrief(title.trim(), content.trim(), productLineId || undefined, audioFile || undefined, mode);
      if (res.code === 0 && res.data) {
        if (mode === 'call_recording') {
          navigate(`/employee/debrief/${res.data.record_id}/session`);
        } else {
          navigate(`/employee/debrief/${res.data.record_id}`);
        }
      } else {
        setError('提交失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setLoading(false);
    }
  };

  const isPostMeeting = mode === 'post_meeting';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/employee/debrief')} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="font-bold text-gray-900">新建复盘</h1>
      </div>

      <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
        {/* Mode selector */}
        <div className="bg-white rounded-xl border p-1 flex mb-6">
          <button
            onClick={() => setMode('post_meeting')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isPostMeeting
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            谈后总结
          </button>
          <button
            onClick={() => setMode('call_recording')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              !isPostMeeting
                ? 'bg-purple-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <PhoneCall className="w-4 h-4" />
            谈单录音
          </button>
        </div>

        {isPostMeeting ? (
          <div className="bg-white rounded-xl border p-6 space-y-6">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                见客主题 / 客户名称
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：拜访张三（某科技公司）"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Product line */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">产品线</label>
              <ProductLineSelector value={productLineId} onChange={(id, _name) => setProductLineId(id)} placeholder="选择产品" className="w-full" />
            </div>

            {/* Content - only for post_meeting */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">谈单情况描述</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="请描述见客过程：客户背景、谈了什么、客户反应、遇到的问题、结果如何..."
                rows={8}
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">也可以只语音描述，不填文字</p>
            </div>

            {/* Audio section - 语音转文字 */}
            <div className="flex items-center gap-3 -mt-4">
              <button
                onClick={recording ? stopRealtimeAsr : startRealtimeAsr}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium ${
                  recording
                    ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                    : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
                }`}
              >
                {recording ? <><Square className="w-4 h-4" /> 停止转写</> : <><Mic className="w-4 h-4" /> 🎤 语音转文字</>}
              </button>
              <label className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 cursor-pointer flex-1 border border-gray-200">
                <Upload className="w-4 h-4" /> 上传音频
                <input type="file" accept="audio/*" className="hidden" onChange={handleFileChange} />
              </label>
            </div>
            {recording && <p className="text-xs text-blue-600 -mt-4">正在实时转写... 请说话</p>}

            {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> 提交中...</> : <><Send className="w-4 h-4" /> 提交复盘</>}
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border p-6 space-y-6">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                客户名称 / 拜访主题
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：拜访张三（某科技公司）"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Product line */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">产品线 <span className="text-red-500">*</span></label>
              <ProductLineSelector value={productLineId} onChange={(id, _name) => setProductLineId(id)} placeholder="选择产品" className="w-full" />
            </div>

            {/* Audio section - required for call_recording */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                对话录音 <span className="text-red-500">*</span>
              </label>

              <label className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 cursor-pointer w-full border border-gray-200">
                <Upload className="w-4 h-4" /> 上传音频
                <input type="file" accept="audio/*" className="hidden" onChange={handleFileChange} />
              </label>

              {audioFile && (
                <p className="text-xs text-green-600 mt-1">已选择：{audioFile.name}</p>
              )}
            </div>

            {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> 提交中...</> : <><Send className="w-4 h-4" /> 开始分析</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
