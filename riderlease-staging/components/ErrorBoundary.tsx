
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
        if (this.props.fallback) {
            return this.props.fallback;
        }
        return (
            <div className="flex items-center justify-center h-full p-8 text-center min-h-[400px]">
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 shadow-2xl max-w-lg">
                    <div className="mx-auto w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
                        <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-bold text-white mb-2">일시적인 오류가 발생했습니다</h2>
                    <p className="text-slate-400 mb-6 text-sm">
                        화면을 표시하는 도중 문제가 발생했습니다.<br/>
                        잠시 후 다시 시도하거나 페이지를 새로고침 해주세요.
                    </p>
                    
                    <div className="bg-slate-900/50 p-3 rounded text-left overflow-auto max-h-32 mb-6 border border-slate-700/50">
                        <p className="text-xs text-red-300 font-mono whitespace-pre-wrap break-all">
                            {this.state.error?.toString()}
                        </p>
                    </div>

                    <button 
                        onClick={() => window.location.reload()} 
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg transition-colors w-full"
                    >
                        페이지 새로고침
                    </button>
                </div>
            </div>
        );
    }

    return this.props.children;
  }
}
