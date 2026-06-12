export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

export interface UploadResponse {
  record_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audio_url: string;
  estimated_seconds: number;
}

export interface StatusResponse {
  record_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  step?: string;
  duration?: number;
  transcript?: string;
  transcript_segments?: TranscriptSegment[];
  error_code?: string;
  error_message?: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence: number;
  low_confidence: boolean;
}

export interface AsrResult {
  taskId: string;
  transcript: string;
  segments: TranscriptSegment[];
}

export interface PracticeRecord {
  record_id: string;
  user_id: string;
  audio_path: string;
  duration: number;
  practice_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  product_line: string;
  transcript: string | null;
  transcript_segments: TranscriptSegment[] | null;
  asr_engine: string | null;
  asr_task_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export type DebriefMode = 'post_meeting' | 'call_recording' | 'simulation';
