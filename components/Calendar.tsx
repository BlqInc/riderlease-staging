
import React, { useState, useMemo } from 'react';
import { CalendarEvent } from '../types';

interface CalendarProps {
  events: CalendarEvent[];
  onAddEvent: (date: string) => void;
  onEditEvent: (event: CalendarEvent) => void;
}

export const Calendar: React.FC<CalendarProps> = ({ events, onAddEvent, onEditEvent }) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  const firstDayOfMonth = useMemo(() => new Date(currentDate.getFullYear(), currentDate.getMonth(), 1), [currentDate]);
  const lastDayOfMonth = useMemo(() => new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0), [currentDate]);

  const daysInMonth = useMemo(() => {
    const days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Days from previous month
    const startDayOfWeek = firstDayOfMonth.getDay();
    const prevMonthLastDay = new Date(firstDayOfMonth.getFullYear(), firstDayOfMonth.getMonth(), 0);
    for (let i = startDayOfWeek; i > 0; i--) {
      const date = new Date(prevMonthLastDay);
      date.setDate(prevMonthLastDay.getDate() - i + 1);
      days.push({ date, isCurrentMonth: false, isToday: false });
    }

    // Days in current month
    for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
      const date = new Date(firstDayOfMonth.getFullYear(), firstDayOfMonth.getMonth(), i);
      const isToday = date.getTime() === today.getTime();
      days.push({ date, isCurrentMonth: true, isToday });
    }

    // Ensure 6 rows for consistent layout
    const nextMonthFirstDay = new Date(lastDayOfMonth.getFullYear(), lastDayOfMonth.getMonth() + 1, 1);
    let dayCounter = 1;
    while (days.length < 42) {
        const date = new Date(nextMonthFirstDay);
        date.setDate(dayCounter++);
        days.push({ date, isCurrentMonth: false, isToday: false });
    }


    return days;
  }, [firstDayOfMonth, lastDayOfMonth]);

  const eventsByDate = useMemo(() => {
    const acc: Record<string, CalendarEvent[]> = {};
    events.forEach(event => {
      const startDate = new Date(event.date);
      startDate.setMinutes(startDate.getMinutes() + startDate.getTimezoneOffset());
      
      const endDate = event.end_date ? new Date(event.end_date) : new Date(startDate);
      endDate.setMinutes(endDate.getMinutes() + endDate.getTimezoneOffset());

      let currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const dateKey = currentDate.toISOString().split('T')[0];
        if (!acc[dateKey]) {
          acc[dateKey] = [];
        }
        acc[dateKey].push(event);
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    for (const dateKey in acc) {
      acc[dateKey].sort((a, b) => (a.time || '23:59').localeCompare(b.time || '23:59'));
    }
    return acc;
  }, [events]);

  const changeMonth = (amount: number) => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + amount, 1));
  };
  
  const goToToday = () => {
    setCurrentDate(new Date());
  }

  const daysOfWeek = ['일', '월', '화', '수', '목', '금', '토'];

  return (
    <div className="p-8 flex flex-col h-full">
      <header className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-4">
            <h2 className="text-3xl font-bold text-white">
                {currentDate.getFullYear()}년 {currentDate.toLocaleString('ko-KR', { month: 'long' })}
            </h2>
            <div className="flex items-center space-x-2">
                <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-slate-700 transition-colors">&lt;</button>
                <button onClick={goToToday} className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-1 px-4 rounded-lg transition-colors text-sm">오늘</button>
                <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-slate-700 transition-colors">&gt;</button>
            </div>
        </div>
      </header>
      
      <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden flex flex-col flex-grow">
          <div className="grid grid-cols-7 border-b border-slate-700">
              {daysOfWeek.map((day, index) => (
                  <div key={day} className={`p-3 text-center font-semibold text-sm ${index === 0 ? 'text-red-400' : index === 6 ? 'text-blue-400' : 'text-slate-400'}`}>{day}</div>
              ))}
          </div>
          <div className="grid grid-cols-7 grid-rows-6 flex-grow">
              {daysInMonth.map(({ date, isCurrentMonth, isToday }, index) => {
                  const dateString = date.toISOString().split('T')[0];
                  const dayEvents = eventsByDate[dateString] || [];
                  const dayOfWeek = date.getDay();
                  const dayClasses = `
                      p-2 border-r border-b border-slate-700 flex flex-col transition-colors cursor-pointer group
                      ${isCurrentMonth ? 'bg-slate-800 hover:bg-slate-700/50' : 'bg-slate-900/50 text-slate-600 hover:bg-slate-800/50'}
                      ${isToday ? 'bg-indigo-900/50' : ''}
                  `;

                  return (
                      <div key={index} className={dayClasses} onClick={() => onAddEvent(dateString)}>
                          <div className={`font-semibold mb-1 ${isToday ? 'text-indigo-300' : dayOfWeek === 0 ? 'text-red-500' : dayOfWeek === 6 ? 'text-blue-500' : ''}`}>{date.getDate()}</div>
                          <div className="space-y-1 overflow-y-auto flex-grow h-0">
                              {dayEvents.map(event => {
                                const displayTitle = `${event.time ? `${event.time} ` : ''}[${event.user}] ${event.title}`;
                                return (
                                  <div 
                                      key={event.id}
                                      onClick={(e) => { e.stopPropagation(); onEditEvent(event); }}
                                      className={`${event.color} text-white text-xs p-1 rounded-md truncate cursor-pointer hover:opacity-80`}
                                      title={displayTitle}
                                  >
                                    {displayTitle}
                                  </div>
                                )
                              })}
                          </div>
                      </div>
                  );
              })}
          </div>
      </div>
    </div>
  );
};