import React, { useState } from 'react';
import { PlusIcon } from './icons/IconComponents';

const VariableInputRow: React.FC<{ index: number; name: string; value: string; }> = ({ index, name, value }) => (
    <div className="flex items-start space-x-4">
        {/* Name Input */}
        <div className="flex-1">
            <div className="relative border border-slate-600 rounded-md pt-4 pb-1 px-3">
                <span className="absolute -top-2.5 left-2 px-1 bg-slate-800 text-xs text-slate-500">이름 {index}</span>
                <input
                    type="text"
                    value={name}
                    readOnly
                    className="w-full bg-transparent text-white focus:outline-none cursor-default"
                />
            </div>
            <p className="text-xs text-slate-500 mt-1 pl-1">예: ENV 또는 .env 파일 붙여넣기</p>
        </div>
        {/* Value Input */}
        <div className="flex-1">
             <div className="relative border border-slate-600 rounded-md pt-4 pb-1 px-3">
                <span className="absolute -top-2.5 left-2 px-1 bg-slate-800 text-xs text-slate-500">값 {index}</span>
                <input
                    type="text"
                    value={value}
                    readOnly
                    className="w-full bg-transparent text-white focus:outline-none cursor-default"
                />
            </div>
            <p className="text-xs text-slate-500 mt-1 pl-1">예: prod</p>
        </div>
    </div>
);

export const DatabaseManagement: React.FC = () => {
    const [activeTab, setActiveTab] = useState('variables');

    const TabButton: React.FC<{ id: string; label: string }> = ({ id, label }) => (
        <button
            onClick={() => setActiveTab(id)}
            className={`py-3 px-4 font-medium text-sm transition-colors ${
                activeTab === id
                    ? 'border-b-2 border-indigo-500 text-white'
                    : 'border-b-2 border-transparent text-slate-400 hover:text-white'
            }`}
        >
            {label}
        </button>
    );

    return (
        <div className="p-8 text-slate-300">
            <h1 className="text-2xl font-bold text-white mb-6">service(us-west1)에 버전 배포</h1>
            
            <div className="border-b border-slate-700">
                <nav className="flex space-x-2 -mb-px">
                    <TabButton id="settings" label="설정" />
                    <TabButton id="variables" label="변수 및 보안 비밀" />
                    <TabButton id="mount" label="볼륨 마운트" />
                </nav>
            </div>
            
            <div className="pt-8">
                {activeTab === 'variables' ? (
                    <div className="space-y-10 max-w-4xl">
                        <div>
                            <h3 className="text-xl font-semibold text-white mb-2">환경 변수</h3>
                            <p className="text-sm text-slate-400 mb-6">
                                이름 입력란에 .env 파일을 붙여넣어 환경 변수를 대량으로 채웁니다.
                            </p>
                            
                            <div className="space-y-6">
                               <VariableInputRow index={1} name="API_KEY" value="AlzaSyAG8Cgr_KeOUcqbHeCmYI-lbT1oF_8tu3U" />
                               <VariableInputRow index={2} name="VITE_SUPABASE_URL" value="https://mwywvwwkwydtbrvelseyt.supabase.co/" />
                               <VariableInputRow index={3} name="VITE_SUPABASE_ANON_KEY" value="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhbm9uX2tleSI6ImV5SmhiR2NpT2lJI..." />
                            </div>

                            <button className="mt-6 flex items-center border border-slate-600 hover:bg-slate-700 text-indigo-400 font-semibold py-1.5 px-4 rounded-md transition-colors text-sm">
                                <PlusIcon className="w-5 h-5 mr-2"/>
                                변수 추가
                            </button>
                        </div>
                        
                        <div>
                             <h3 className="text-xl font-semibold text-white mb-4">환경 변수로 노출된 보안 비밀</h3>
                             <div className="bg-slate-900/50 border border-slate-700 text-slate-300 p-4 rounded-lg flex items-start">
                                <svg className="w-5 h-5 mr-3 flex-shrink-0 mt-0.5 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div>
                                    <p className="text-sm">이 섹션에서는 보안 비밀을 환경 변수로 노출할 수 있습니다. 보안 비밀을 볼륨으로 마운트하려면 <button type="button" onClick={() => setActiveTab('mount')} className="text-indigo-400 hover:underline font-semibold">볼륨 탭</button>으로 이동하고 볼륨을 만든 후 볼륨 마운트 탭에서 마운트하세요.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                     <div className="bg-slate-800 p-8 rounded-lg shadow-lg text-center max-w-4xl">
                        <p className="text-slate-400">이 탭의 내용은 구현되지 않았습니다.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
