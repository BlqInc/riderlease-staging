
import React, { useState, useEffect } from 'react';
import { CalendarEvent } from '../types';
import { CloseIcon, TrashIcon } from './icons/IconComponents';

interface EventFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (eventData: Omit<CalendarEvent, 'id'> & { id?: string }) => void;
  onDelete: (eventId: string) => void;
  eventToEdit: Partial<CalendarEvent> | null;
  selectedDate: string;
}

const colorPalette = [
  'bg-red-500',
  'bg-yellow-500',
  'bg-green-500',
  'bg-blue-500',
  'bg-indigo-500',
  'bg-purple-500',
  'bg-pink-500',
];

export const EventFormModal: React.FC<EventFormModalProps> = ({ isOpen, onClose, onSave, onDelete, eventToEdit, selectedDate }) => {
  const [title, setTitle] = useState('');
  const [user, setUser] = useState('');
  const [color, setColor] = useState(colorPalette[0]);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(eventToEdit?.title || '');
      setUser(eventToEdit?.user || '');
      setColor(eventToEdit?.color || colorPalette[0]);
      setEndDate(eventToEdit?.end_date || null);
      setTime(eventToEdit?.time || null);
    }
  }, [eventToEdit, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !user.trim()) {
      alert('일정과 담당자를 모두 입력해주세요.');
      return;
    }
    const saveData: Omit<CalendarEvent, 'id'> & { id?: string } = {
      title,
      user,
      date: eventToEdit?.date || selectedDate,
      color: color,
      end_date: endDate || null,
      time: time || null,
    };
    if (eventToEdit?.id) {
        saveData.id = eventToEdit.id;
    }
    onSave(saveData);
  };

  const handleDelete = () => {
    if (eventToEdit?.id && window.confirm(`'${eventToEdit.title}' 일정을 삭제하시겠습니까?`)) {
        onDelete(eventToEdit.id);
    }
  }
  
  const titleText = eventToEdit && eventToEdit.id ? '일정 수정' : '새 일정 추가';
  const startDateText = new Date(eventToEdit?.date || selectedDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  const endDateText = endDate ? new Date(endDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const dateText = endDate && endDate !== (eventToEdit?.date || selectedDate) ? `${startDateText} ~ ${endDateText}` : startDateText;


  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">
        <header className="flex justify-between items-center p-6 border-b border-slate-700">
          <div>
            <h2 className="text-2xl font-bold text-white">{titleText}</h2>
            <p className="text-indigo-300">{dateText}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 transition-colors">
            <CloseIcon className="w-6 h-6 text-slate-400" />
          </button>
        </header>
        
        <form onSubmit={handleSubmit}>
            <div className="p-6 space-y-4">
                <div>
                    <label htmlFor="eventTitle" className="block text-sm font-medium text-slate-400 mb-2">일정 내용</label>
                    <input 
                        id="eventTitle"
                        type="text" 
                        value={title} 
                        onChange={(e) => setTitle(e.target.value)} 
                        placeholder="예: 월간 리포트 제출" 
                        className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                        required 
                        autoFocus
                    />
                </div>
                 <div>
                    <label htmlFor="eventUser" className="block text-sm font-medium text-slate-400 mb-2">담당자</label>
                    <input 
                        id="eventUser"
                        type="text" 
                        value={user} 
                        onChange={(e) => setUser(e.target.value)} 
                        placeholder="예: 김철수" 
                        className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                        required
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label htmlFor="endDate" className="block text-sm font-medium text-slate-400 mb-2">종료일 (선택)</label>
                        <input
                            id="endDate"
                            type="date"
                            value={endDate || ''}
                            onChange={(e) => setEndDate(e.target.value || null)}
                            min={eventToEdit?.date || selectedDate}
                            className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                     <div>
                        <label htmlFor="time" className="block text-sm font-medium text-slate-400 mb-2">시간 (선택)</label>
                        <input
                            id="time"
                            type="time"
                            value={time || ''}
                            onChange={(e) => setTime(e.target.value || null)}
                            className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">표시 색상</label>
                  <div className="flex space-x-2">
                    {colorPalette.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={`w-8 h-8 rounded-full transition-transform transform hover:scale-110 ${c} ${color === c ? 'ring-2 ring-offset-2 ring-offset-slate-800 ring-white' : ''}`}
                        aria-label={`Select ${c} color`}
                      />
                    ))}
                  </div>
                </div>
            </div>
            
            <footer className="p-6 bg-slate-800/50 flex justify-between items-center">
                <div>
                    {eventToEdit && eventToEdit.id && (
                        <button type="button" onClick={handleDelete} className="flex items-center bg-red-600/80 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                            <TrashIcon className="w-5 h-5 mr-2" />
                            삭제
                        </button>
                    )}
                </div>
                <div className="flex space-x-4">
                    <button type="button" onClick={onClose} className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                        취소
                    </button>
                    <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                        저장
                    </button>
                </div>
            </footer>
        </form>
      </div>
    </div>
  );
};