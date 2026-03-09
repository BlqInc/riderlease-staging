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
                            이 애플리케이션은 Supabase 데이터베이스에 연결해야 작동합니다. 하지만 Vercel에 배포할 때, 연결에 필요한 아래의 두 환경 변수가 **빌드 시점**에 제공되지 않았습니다.
                        </p>
                        <div className="mt-4 bg-slate-900 rounded-lg p-4 font-mono text-yellow-400 text-sm">
                            <pre>{codeSnippet}</pre>
                        </div>
                         <p className="text-slate-400 mt-3">
                            Vite(빌드 도구)는 앱을 생성하는 '빌드' 과정에서 이 값들을 코드에 직접 삽입합니다. 따라서, Vercel 프로젝트 설정에서 환경 변수를 추가한 후에는 **반드시 재배포(Redeploy)를 진행**해야 합니다.
                        </p>
                    </div>

                    <div>
                        <h2 className="text-xl font-semibold text-white mb-3">해결 방법 (Vercel 기준)</h2>
                        <p className="text-slate-400 mb-4">
                            Vercel 프로젝트 설정에서 다음 단계를 따라 환경 변수를 추가하고 재배포하세요.
                        </p>
                        <ol className="list-decimal list-inside space-y-3 text-slate-300">
                            <li>Vercel에 로그인하여 현재 프로젝트의 대시보드로 이동합니다.</li>
                            <li><strong className="text-indigo-400">[Settings]</strong> 탭을 클릭한 후, 왼쪽 메뉴에서 <strong className="text-indigo-400">[Environment Variables]</strong>를 선택합니다.</li>
                            <li>
                                <strong className="text-yellow-400">'Key'</strong> 에는 반드시 <code className="bg-slate-700 px-1 rounded-sm">VITE_</code> 접두사를 포함하여 아래와 같이 입력하고, 'Value'에는 본인의 Supabase 키를 입력합니다.
                                <ul className="list-disc list-inside ml-6 mt-2">
                                    <li>Key: <code className="bg-slate-700 px-1 rounded-sm">VITE_SUPABASE_URL</code></li>
                                    <li>Key: <code className="bg-slate-700 px-1 rounded-sm">VITE_SUPABASE_ANON_KEY</code></li>
                                </ul>
                            </li>
                            <li>변수 저장이 완료되면, <strong className="text-indigo-400">[Deployments]</strong> 탭으로 이동합니다.</li>
                            <li>가장 최근 배포 항목 오른쪽의 **[...]** 메뉴를 클릭하고, <strong className="text-yellow-400">[Redeploy]</strong>를 눌러 프로젝트를 다시 배포합니다.</li>
                        </ol>
                    </div>

                </main>
                 <footer className="p-6 bg-slate-900/50 border-t border-slate-700 text-center">
                    <p className="text-sm text-slate-500">
                       이 화면은 데이터베이스 연결 정보가 올바르게 설정되고 재배포가 완료되면 자동으로 사라집니다.
                    </p>
                </footer>
            </div>
        </div>
    );
};
