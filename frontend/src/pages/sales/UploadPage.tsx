import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, UploadCloud, Square, Play, RotateCcw, Pause, AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { uploadAudio } from '../../api/debrief';
import { ProductLineSelector } from '../../components/ProductLineSelector';

type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function UploadPage() {
  const navigate = useNavigate();
  const { setUploadProgress, uploadProgress, user, setCurrentRecordId } = useAppStore();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadDuration, setUploadDuration] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [productLineId, setProductLineId] = useState('');
  const [productLineName, setProductLineName] = useState('');

  // Upload result
  const [uploadedRecordId, setUploadedRecordId] = useState<string | null>(null);

  // Recording states
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string>('');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [micError, setMicError] = useState<string>('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setInterval(() => {
      setRecordSeconds((s) => s + 1);
    }, 1000);
  }, [clearTimer]);

  const stopMedia = useCallback(() => {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    clearTimer();
  }, [clearTimer]);

  const startRecording = async () => {
    setMicError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setRecordedBlob(blob);
        setRecordedUrl(URL.createObjectURL(blob));
        setRecordingState('stopped');
      };

      mediaRecorder.start(1000);
      setRecordingState('recording');
      setRecordSeconds(0);
      startTimer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('NotAllowedError') || message.includes('Permission denied')) {
        setMicError('麦克风权限被拒绝，请在浏览器地址栏中允许使用麦克风。');
      } else {
        setMicError('无法启动录音：' + message);
      }
    }
  };

  const pauseRecording = () => {
    mediaRecorderRef.current?.pause();
    setRecordingState('paused');
    clearTimer();
  };

  const resumeRecording = () => {
    mediaRecorderRef.current?.resume();
    setRecordingState('recording');
    startTimer();
  };

  const stopRecording = () => {
    stopMedia();
    // onstop handler will set state to 'stopped'
  };

  const resetRecording = () => {
    stopMedia();
    setRecordedBlob(null);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl('');
    setRecordSeconds(0);
    setRecordingState('idle');
  };

  useEffect(() => {
    return () => {
      stopMedia();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [stopMedia, recordedUrl]);

  const performUpload = async (file: File, fileName: string, durationText: string) => {
    if (!user) {
      setUploadError('请先登录');
      return;
    }
    setIsUploading(true);
    setUploadError('');
    setUploadFileName(fileName);
    setUploadDuration(durationText);
    setUploadProgress(0);

    try {
      const result = await uploadAudio(
        file,
        productLineName,
        'intro',
        (percent) => setUploadProgress(percent)
      );
      const recordId = result.data.record_id;
      setCurrentRecordId(recordId);
      setUploadedRecordId(recordId);
      setIsUploading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : '上传失败';
      setUploadError(message);
      setIsUploading(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    if (isUploading) return;
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const durationText = `大小: ${(file.size / 1024 / 1024).toFixed(2)}MB`;
    performUpload(file, file.name, durationText);
    e.target.value = '';
  };

  const submitRecording = () => {
    if (!recordedBlob) return;
    const ext = recordedBlob.type.includes('webm') ? 'webm' : 'm4a';
    const fileName = `产品介绍_${user?.name || '未知'}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.${ext}`;
    const durationText = `${formatTime(recordSeconds)} · 大小: ${(recordedBlob.size / 1024 / 1024).toFixed(2)}MB`;
    const file = new File([recordedBlob], fileName, { type: recordedBlob.type });
    performUpload(file, fileName, durationText);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (isUploading) return;
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const validTypes = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'];
      const validExts = ['.mp3', '.wav', '.m4a', '.webm'];
      const isValidType = validTypes.includes(file.type) || validExts.some((ext) => file.name.toLowerCase().endsWith(ext));
      if (!isValidType) {
        setUploadError('格式不支持，请上传 mp3 / wav / m4a / webm 格式的音频文件');
        return;
      }
      const durationText = `大小: ${(file.size / 1024 / 1024).toFixed(2)}MB`;
      performUpload(file, file.name, durationText);
    }
  };

  return (
    <section className="fade-in space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-2">上传产品介绍语音</h2>
        <p className="text-gray-500 mb-6">建议录制5—20分钟产品介绍，环境保持安静，支持 mp3 / wav / m4a 格式</p>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">员工信息</label>
            <input type="text" defaultValue={user?.name || ''} readOnly className="w-full border rounded-lg px-3 py-2 bg-gray-50 text-gray-500 cursor-not-allowed" placeholder="姓名" />
            <input type="text" defaultValue={user?.employeeId || ''} readOnly className="w-full border rounded-lg px-3 py-2 bg-gray-50 text-gray-500 cursor-not-allowed" placeholder="工号" />
            <ProductLineSelector
              value={productLineId}
              onChange={(id, name) => { setProductLineId(id); setProductLineName(name); }}
              className="w-full"
            />
          </div>

          <div className="space-y-3">
            <div
              onClick={!isUploading ? handleUploadClick : undefined}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={`border-2 border-dashed border-gray-300 rounded-xl p-8 text-center transition-colors ${!isUploading ? 'hover:border-blue-500 cursor-pointer' : 'cursor-default'}`}
            >
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <UploadCloud className="w-8 h-8 text-blue-600" />
              </div>
              <p className="text-gray-900 font-medium">点击上传或拖拽文件到此处</p>
              <p className="text-gray-400 text-sm mt-1">支持 mp3, wav, m4a, webm · 最大100MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/webm,.mp3,.wav,.m4a,.webm"
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Recording Panel */}
            <div className="border rounded-xl p-4 bg-gray-50">
              {micError && (
                <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{micError}</span>
                </div>
              )}

              {recordingState === 'idle' && (
                <button
                  onClick={startRecording}
                  disabled={isUploading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  <Mic className="w-5 h-5" />
                  开始录音
                </button>
              )}

              {(recordingState === 'recording' || recordingState === 'paused') && (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${recordingState === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'}`} />
                    <span className="text-2xl font-mono font-bold text-gray-900">{formatTime(recordSeconds)}</span>
                  </div>
                  <div className="flex items-center gap-3 w-full">
                    {recordingState === 'recording' ? (
                      <button onClick={pauseRecording} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-white border rounded-lg font-medium hover:bg-gray-100">
                        <Pause className="w-4 h-4" />
                        暂停
                      </button>
                    ) : (
                      <button onClick={resumeRecording} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-white border rounded-lg font-medium hover:bg-gray-100">
                        <Play className="w-4 h-4" />
                        继续
                      </button>
                    )}
                    <button onClick={stopRecording} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700">
                      <Square className="w-4 h-4 fill-current" />
                      结束录音
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    {recordingState === 'recording' ? '正在录音中...' : '录音已暂停'}
                  </p>
                </div>
              )}

              {recordingState === 'stopped' && (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-gray-600">
                    录音完成 · 时长 <span className="font-mono font-bold text-gray-900">{formatTime(recordSeconds)}</span>
                  </p>
                  {recordedUrl && (
                    <audio src={recordedUrl} controls className="w-full" />
                  )}
                  <div className="flex items-center gap-3 w-full">
                    <button onClick={resetRecording} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-white border rounded-lg font-medium hover:bg-gray-100">
                      <RotateCcw className="w-4 h-4" />
                      重录
                    </button>
                    <button
                      onClick={submitRecording}
                      disabled={isUploading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      <UploadCloud className="w-4 h-4" />
                      上传录音
                    </button>
                  </div>
                  {recordSeconds < 120 && (
                    <p className="text-xs text-yellow-600">
                      音频时长不足 2 分钟，建议录制 5 分钟以上以获得更准确的诊断。
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {uploadError && (
          <div className="mt-6 p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {isUploading && (
          <div className="mt-6">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-medium text-gray-700">正在上传: {uploadFileName}</span>
              <span className="text-gray-500">{Math.floor(uploadProgress)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1">{uploadDuration}</p>
          </div>
        )}

        {/* Upload complete → start practice */}
        {uploadedRecordId && !isUploading && (
          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <div>
                  <p className="font-medium text-green-900">上传完成</p>
                  <p className="text-sm text-green-700">音频已上传，可以开始练习</p>
                </div>
              </div>
              <button
                onClick={() => navigate(`/employee/debrief/${uploadedRecordId}/session`)}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center gap-2"
              >
                开始练习
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

    </section>
  );
}
