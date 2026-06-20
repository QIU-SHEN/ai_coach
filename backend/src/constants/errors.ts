export class AppError extends Error {
  constructor(
    public status: number,
    public code: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// HTTP 400 Bad Request - Client upload validation errors
export const ERR_FILE_TOO_LARGE = { code: 400001, message: '文件大小超过100MB限制' };
export const ERR_UNSUPPORTED_FORMAT = { code: 400002, message: '格式不支持，请转换为mp3/wav/m4a后重新上传' };
export const ERR_AUDIO_TOO_SHORT = { code: 400003, message: '产品介绍过短，无法完成有效诊断，建议补充至5分钟以上' };
export const ERR_POOR_AUDIO_QUALITY = { code: 400004, message: '音频质量不佳，请检查录音环境后重试' };
export const ERR_RETRY_NOT_ALLOWED = { code: 400005, message: '仅失败记录可重试' };
export const ERR_MISSING_PARAMS = { code: 400000, message: '缺少必要参数' };

// HTTP 403 Forbidden
export const ERR_FORBIDDEN = { code: 403000, message: '无权访问' };

// HTTP 404 Not Found
export const ERR_RECORD_NOT_FOUND = { code: 404000, message: '记录不存在' };

// HTTP 500 Internal Server Error
export const ERR_INTERNAL_SERVER = { code: 500000, message: '系统暂时无法处理，请稍后重试' };

// ASR failure standard error codes (stored in DB and returned in GET /status)
export const ASR_ERROR_CODES = {
  ASR_TIMEOUT: {
    code: 'ASR_TIMEOUT',
    message: '语音识别失败，请检查音频质量或分段上传',
  },
  ASR_EMPTY_RESULT: {
    code: 'ASR_EMPTY_RESULT',
    message: '语音识别结果为空，请检查音频质量或分段上传',
  },
  STORAGE_UPLOAD_FAILED: {
    code: 'STORAGE_UPLOAD_FAILED',
    message: '系统暂时无法处理，请稍后重试',
  },
  UNKNOWN: {
    code: 'UNKNOWN',
    message: '处理失败',
  },
} as const;
