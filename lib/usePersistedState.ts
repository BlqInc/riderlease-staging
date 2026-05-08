import { useState, useEffect, Dispatch, SetStateAction } from 'react';

/**
 * useState와 localStorage 동기화. 페이지 이동/새로고침 후에도 필터 등 상태 유지.
 *
 * @param key  localStorage 키 (전역 고유. 예: 'collection-mgmt:risk-filter')
 * @param defaultValue  초기값
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      if (typeof window === 'undefined') return defaultValue;
      const stored = window.localStorage.getItem(key);
      if (stored === null) return defaultValue;
      return JSON.parse(stored) as T;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 용량 초과 등 - 무시
    }
  }, [key, value]);

  return [value, setValue];
}
