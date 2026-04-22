import React from 'react';

interface Props {
  text: string;
  /** 말풍선 위치 (기본 top) */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** 아이콘 대신 커스텀 children */
  children?: React.ReactNode;
  className?: string;
}

const placementClass: Record<NonNullable<Props['placement']>, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

export const InfoTooltip: React.FC<Props> = ({ text, placement = 'top', children, className = '' }) => (
  <span className={`group relative inline-flex items-center ${className}`}>
    {children ?? (
      <span className="text-slate-500 hover:text-slate-200 cursor-help text-[10px] border border-slate-600 rounded-full w-3.5 h-3.5 inline-flex items-center justify-center font-bold leading-none">
        ?
      </span>
    )}
    <span className={`invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity
                      absolute ${placementClass[placement]} px-3 py-2
                      bg-slate-900 text-slate-100 text-xs rounded-lg shadow-xl border border-slate-600
                      whitespace-pre-line text-left font-normal z-50 pointer-events-none w-64`}>
      {text}
    </span>
  </span>
);
