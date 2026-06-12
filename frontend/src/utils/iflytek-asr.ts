// 讯飞实时语音转写大模型 WebSocket 客户端
// 基于 temp/index.html 验证过的实现封装
// 文档: https://www.xfyun.cn/doc/asr/rtasr/API.html

const CONFIG = {
  APPID: '743e8839',
  APIKey: '4b1b98f4c5a6e1b6d67404d4f4470a9d',
  APISecret: 'NGEwMmM4MDg2MDk2N2MwMDIwZjcxMzQ5',
  WS_URL: 'wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1',
  TARGET_RATE: 16000,
  FRAME_MS: 40,
  FRAME_SIZE: 1280, // 40ms * 16kHz * 2bytes = 1280 bytes
} as const;

/* ==================== 工具函数 ==================== */

function genUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Python urllib.parse.quote(v, safe='') 的兼容实现
function pctEnc(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/~/g, '%7E');
}

// HMAC-SHA1 签名（使用 Web Crypto API）
async function makeSign(params: Record<string, string>, secret: string): Promise<string> {
  const keys = Object.keys(params).sort();
  const pairs = keys.map((k) => pctEnc(k) + '=' + pctEnc(String(params[k])));
  const base = pairs.join('&');

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(base));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// 生成 UTC 时间格式：yyyy-MM-dd'T'HH:mm:ss+0800
function getUtcTime(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return yyyy + '-' + MM + '-' + dd + 'T' + hh + ':' + mm + ':' + ss + '+0800';
}

// 构建 WebSocket URL（带签名）
async function buildWsUrl(): Promise<string> {
  const uuid = genUUID();
  const utc = getUtcTime();

  const params: Record<string, string> = {
    accessKeyId: CONFIG.APIKey,
    appId: CONFIG.APPID,
    audio_encode: 'pcm_s16le',
    lang: 'autodialect',
    samplerate: '16000',
    utc,
    uuid,
  };

  params.signature = await makeSign(params, CONFIG.APISecret);

  // 排序后构建查询字符串
  const qs = Object.keys(params).sort()
    .map((k) => pctEnc(k) + '=' + pctEnc(String(params[k])))
    .join('&');

  return CONFIG.WS_URL + '?' + qs;
}

// 线性插值重采样
function resample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] || 0;
    const b = input[Math.min(idx + 1, input.length - 1)] || 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

// Float32 -> Int16
function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7FFF);
  }
  return out;
}

/* ==================== 接口 ==================== */

export interface IFlytekAsrOptions {
  /** 收到文字回调（finalText, interimText, isFinal） */
  onText: (finalText: string, interimText: string, isFinal: boolean) => void;
  /** 错误回调 */
  onError: (error: string) => void;
  /** 状态变化回调 */
  onStatusChange: (status: 'idle' | 'connecting' | 'recording') => void;
  /** 可选：音量变化回调（0-100） */
  onVolume?: (percent: number) => void;
}

/* ==================== 主类 ==================== */

export class IFlytekAsrClient {
  private options: IFlytekAsrOptions;

  // 音频
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  // WebSocket
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;

  // 状态
  private status: 'idle' | 'connecting' | 'recording' = 'idle';
  private isRecording = false;

  // 音频缓冲
  private pcmBuffer: number[] = [];

  // 发送定时器
  private sendTimer: ReturnType<typeof setInterval> | null = null;

  // 结果文本
  private finalText = '';
  private interimText = '';

  constructor(options: IFlytekAsrOptions) {
    this.options = options;
  }

  /** 获取当前状态 */
  getStatus(): 'idle' | 'connecting' | 'recording' {
    return this.status;
  }

  /** 获取当前完整文本（final + interim） */
  getFullText(): string {
    return this.finalText + this.interimText;
  }

  /** 开始录音并实时转写 */
  async start(): Promise<void> {
    if (this.isRecording) return;

    try {
      this.status = 'connecting';
      this.options.onStatusChange('connecting');

      this.finalText = '';
      this.interimText = '';
      this.pcmBuffer = [];
      this.sessionId = null;

      // 1. 初始化麦克风
      await this.initMic();

      // 2. 连接 WebSocket
      await this.connectWS();

      // 3. 等待服务端初始化（参考Python代码）
      await new Promise((r) => setTimeout(r, 1500));

      this.isRecording = true;
      this.status = 'recording';
      this.options.onStatusChange('recording');

      // 4. 开始定时发送音频
      this.startAudioSender();
    } catch (err: any) {
      this.options.onError(err?.message || '启动失败');
      this.cleanup();
    }
  }

  /** 停止录音 */
  stop(): void {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }

    // 发送剩余数据
    if (this.pcmBuffer.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const buf = new ArrayBuffer(this.pcmBuffer.length * 2);
      const view = new DataView(buf);
      for (let i = 0; i < this.pcmBuffer.length; i++) {
        view.setInt16(i * 2, this.pcmBuffer[i], true);
      }
      this.ws.send(buf);
    }

    // 发送结束标识
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const endMsg: Record<string, unknown> = { end: true };
      if (this.sessionId) endMsg.sessionId = this.sessionId;
      this.ws.send(JSON.stringify(endMsg));
    }

    setTimeout(() => {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
    }, 500);

    this.cleanup();
  }

  /* ==================== 私有方法 ==================== */

  private async initMic(): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: 48000 },
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const actualSampleRate = this.audioCtx.sampleRate;
    // eslint-disable-next-line no-console
    console.log('[iFlytekASR] 浏览器实际采样率: ' + actualSampleRate + ' Hz');

    this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);
    const bufferSize = 2048;
    this.scriptNode = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);
    this.sourceNode.connect(this.scriptNode);

    // ScriptProcessor 必须连接到 destination 才能正常工作
    // 用 GainNode（音量为0）连接，避免麦克风声音回环（啸叫）
    const gainNode = this.audioCtx.createGain();
    gainNode.gain.value = 0;
    this.scriptNode.connect(gainNode);
    gainNode.connect(this.audioCtx.destination);

    this.pcmBuffer = [];

    this.scriptNode.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.isRecording) return;

      const input = e.inputBuffer.getChannelData(0);

      // 计算音量
      if (this.options.onVolume) {
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += Math.abs(input[i]);
        const avg = sum / input.length;
        const pct = Math.min(100, Math.round(avg * 500));
        this.options.onVolume(pct);
      }

      // 重采样到 16kHz
      const resampled = resample(input, this.audioCtx!.sampleRate, CONFIG.TARGET_RATE);
      // 转换为 Int16 PCM
      const pcm = floatToInt16(resampled);
      this.pcmBuffer.push(...pcm);
    };

    // eslint-disable-next-line no-console
    console.log('[iFlytekASR] 麦克风初始化完成');
  }

  private async connectWS(): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      (async () => {
        try {
          const url = await buildWsUrl();
          // eslint-disable-next-line no-console
          console.log('[iFlytekASR] WebSocket URL:', url);

          this.ws = new WebSocket(url);

          this.ws.onopen = () => {
            // eslint-disable-next-line no-console
            console.log('[iFlytekASR] WebSocket 连接成功');
            resolved = true;
            resolve();
          };

          this.ws.onmessage = (ev) => this.handleMessage(ev.data);

          this.ws.onerror = () => {
            if (!resolved) {
              resolved = true;
              reject(new Error('WebSocket 连接错误'));
            }
          };

          this.ws.onclose = (ev) => {
            if (!resolved) {
              resolved = true;
              reject(new Error('WebSocket 连接关闭: ' + ev.code));
            }
          };

          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              reject(new Error('连接超时'));
            }
          }, 10000);
        } catch (e: any) {
          if (!resolved) {
            resolved = true;
            reject(e);
          }
        }
      })();
    });
  }

  private handleMessage(raw: string): void {
    try {
      // eslint-disable-next-line no-console
      console.log('[iFlytekASR] 收到原始:', raw.substring(0, 200));
      const msg = JSON.parse(raw);

      const msgType = msg.msg_type || msg.action;

      if (msgType === 'started') {
        // eslint-disable-next-line no-console
        console.log('[iFlytekASR] 握手成功');
      } else if (msgType === 'result') {
        if (msg.res_type === 'asr') {
          this.parseAsrResult(msg.data);
        }
      } else if (msg.data && msg.data.sessionId) {
        this.sessionId = msg.data.sessionId;
        // eslint-disable-next-line no-console
        console.log('[iFlytekASR] SessionId:', this.sessionId);
      } else if (msgType === 'error') {
        this.options.onError(msg.desc || msg.message || '转写服务错误');
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[iFlytekASR] 消息解析失败:', e.message);
    }
  }

  private parseAsrResult(data: any): void {
    if (!data || !data.cn || !data.cn.st || !data.cn.st.rt) return;

    const rt = data.cn.st.rt;
    let text = '';

    rt.forEach((item: any) => {
      if (!item.ws) return;
      item.ws.forEach((w: any) => {
        if (!w.cw) return;
        w.cw.forEach((c: any) => { if (c.w) text += c.w; });
      });
    });

    if (!text) return;

    const isFinal = data.cn.st.type === '0';

    if (isFinal) {
      this.finalText += text;
      this.interimText = '';
    } else {
      this.interimText = text;
    }

    this.options.onText(this.finalText, this.interimText, isFinal);
  }

  private startAudioSender(): void {
    // 每 40ms 发送 1280 字节（640 个 Int16）
    const SAMPLES_PER_SEND = CONFIG.FRAME_SIZE / 2; // 640
    let sendCount = 0;

    this.sendTimer = setInterval(() => {
      if (!this.isRecording || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      if (this.pcmBuffer.length < SAMPLES_PER_SEND) {
        // 缓冲不足，跳过
        if (sendCount % 50 === 0) {
          // eslint-disable-next-line no-console
          console.warn('[iFlytekASR] 缓冲不足:', this.pcmBuffer.length, '<', SAMPLES_PER_SEND);
        }
        return;
      }

      const frame = this.pcmBuffer.splice(0, SAMPLES_PER_SEND);

      // 转为 Uint8Array（WebSocket 发送二进制最安全的方式）
      const uint8 = new Uint8Array(frame.length * 2);
      const view = new DataView(uint8.buffer);
      for (let i = 0; i < frame.length; i++) {
        view.setInt16(i * 2, frame[i], true); // little-endian
      }

      // 使用 Blob 包装（某些浏览器兼容性更好）
      const blob = new Blob([uint8.buffer]);
      this.ws.send(blob);
      sendCount++;

      if (sendCount % 25 === 0) {
        // eslint-disable-next-line no-console
        console.log('[iFlytekASR] 已发送', sendCount, '帧');
      }
    }, CONFIG.FRAME_MS);
  }

  private cleanup(): void {
    this.status = 'idle';
    this.isRecording = false;

    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }

    this.options.onStatusChange('idle');
  }
}
