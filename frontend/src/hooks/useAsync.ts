import { useState, useEffect, useCallback, useRef } from 'react';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[] = []
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: '',
  });
  const mountedRef = useRef(true);
  // Monotonically-increasing counter: each execute() call gets its own ID.
  // Only the most-recent call is allowed to commit state, preventing stale
  // in-flight requests from overwriting results after a dep change or reload.
  const executionIdRef = useRef(0);

  const execute = useCallback(async () => {
    const id = ++executionIdRef.current;
    setState(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const result = await fn();
      if (mountedRef.current && executionIdRef.current === id) {
        setState({ data: result, loading: false, error: '' });
      }
    } catch (err) {
      if (mountedRef.current && executionIdRef.current === id) {
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : '加载失败',
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    execute();
    return () => { mountedRef.current = false; };
  }, [execute]);

  return { ...state, reload: execute };
}
