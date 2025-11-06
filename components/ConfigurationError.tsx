import React from 'react';
import { TerminalIcon, DatabaseIcon } from './icons/IconComponents';

export const ConfigurationError: React.FC = () => {
    const codeSnippet = `VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...`;

    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-900 text-slate-300 p-4">
            <div className="w-full max-w-4xl bg-slate-800 rounded-xl shadow-2xl border border-slate-700 overflow-hidden">
                <header className="p-6 bg-red-900/50 border-b border-red-700 flex items-center space-x-4">
                    <div className="w-12 h-12 bg-red-500/20 rounded-lg flex items-center justify-center">
                        <DatabaseIcon className="w-7 h-7 text-red-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">데이터베이스 연결 설정 오류</h1>
                        <p className="text-red-300">애플리케이션을 시작하기 위해 환경 변수 설정이 필요합니다.</p>
                    </div>
                </header>

                <main className="p-8 space-y-8">
                    <div>
                        <h2 className="text-xl font-semibold text-white mb-3">문제 원인</h2>
                        <p className="text-slate-400">
                            이 애플리케이션은 Supabase 데이터베이스에 연결해야 작동합니다. 하지만 연결에 필요한 아래의 두 환경 변수가 **빌드 시점**에 제공되지 않았습니다.
                        </p>
                        <div className="mt-4 bg-slate-900 rounded-lg p-4 font-mono text-yellow-400 text-sm">
                            <pre>{codeSnippet}</pre>
                        </div>
                         <p className="text-slate-400 mt-3">
                            Vite(빌드 도구)는 앱을 생성하는 '빌드' 과정에서 이 값들을 코드에 직접 삽입하기 때문에, 앱이 실행되는 '런타임'이 아닌 **'빌드' 과정에서 변수를 설정**해주어야 합니다.
                        </p>
                    </div>

                    <div>
                        <h2 className="text-xl font-semibold text-white mb-3">해결 방법 (Google Cloud Run 기준)</h2>
                        <p className="text-slate-400 mb-4">
                            Cloud Run 배포 설정에서 **'런타임' 변수가 아닌 '빌드' 환경 변수**에 키를 추가해야 합니다.
                        </p>
                        <ol className="list-decimal list-inside space-y-3 text-slate-300">
                            <li>Cloud Run 서비스에서 <strong className="text-indigo-400">[새 버전 수정 및 배포]</strong> 버튼을 클릭합니다.</li>
                            <li>'Cloud Build로 빌드' 섹션에서 <strong className="text-indigo-400">[고급 설정 열기]</strong> 링크를 클릭하여 숨겨진 메뉴를 엽니다.</li>
                            <li>나타나는 메뉴에서 <strong className="text-yellow-400">'빌드 환경 변수'</strong> 항목을 찾습니다.</li>
                            <li>
                                <strong className="text-yellow-400">[+ 변수 추가]</strong> 버튼을 눌러 위의 두 변수(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)와 그 값들을 각각 추가합니다.
                            </li>
                            <li>페이지 하단의 <strong className="text-indigo-400">[배포]</strong> 버튼을 눌러 다시 배포합니다.</li>
                        </ol>
                    </div>

                </main>
                 <footer className="p-6 bg-slate-900/50 border-t border-slate-700 text-center">
                    <p className="text-sm text-slate-500">
                       이 화면은 데이터베이스 연결 정보가 올바르게 설정되면 자동으로 사라집니다.
                    </p>
                </footer>
            </div>
        </div>
    );
};
