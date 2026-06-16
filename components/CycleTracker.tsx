

import React, { useState, useMemo } from 'react';
import { CycleDayLog, MenstrualFlow, PainSymptom, MoodSymptom } from '../types';
import { ChevronLeft, ChevronRight, X, CalendarHeart } from 'lucide-react';

interface CycleTrackerProps {
  logs: CycleDayLog[];
  onUpdateLog: (log: CycleDayLog) => void;
  onBack: () => void;
}

const PAIN_SYMPTOMS: PainSymptom[] = ['cramps', 'headache', 'backache', 'tender_breasts'];
const MOOD_SYMPTOMS: MoodSymptom[] = ['calm', 'happy', 'sad', 'anxious', 'irritable', 'energetic'];
const FLOW_LEVELS: MenstrualFlow[] = ['spotting', 'light', 'medium', 'heavy'];

const SYMPTOM_LABELS: Record<PainSymptom | MoodSymptom, string> = {
  cramps: '腹痛',
  headache: '头痛',
  backache: '腰酸',
  tender_breasts: '乳房胀痛',
  calm: '平静',
  happy: '开心',
  sad: '难过',
  anxious: '焦虑',
  irritable: '易怒',
  energetic: '精力充沛'
};

const FLOW_LABELS: Record<MenstrualFlow, string> = {
  none: '无',
  spotting: '点滴',
  light: '量少',
  medium: '中等',
  heavy: '量大'
};

const CycleTracker: React.FC<CycleTrackerProps> = ({ logs, onUpdateLog, onBack }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [currentLog, setCurrentLog] = useState<CycleDayLog | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  const { month, year, daysInMonth, firstDayOfMonth } = useMemo(() => {
    const d = new Date(currentDate);
    const month = d.getMonth();
    const year = d.getFullYear();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    return { month, year, daysInMonth, firstDayOfMonth };
  }, [currentDate]);

  const logsByDate = useMemo(() => {
    const map = new Map<string, CycleDayLog>();
    logs.forEach(log => map.set(log.date, log));
    return map;
  }, [logs]);

  const getDayStatus = (day: number) => {
    const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    const log = logsByDate.get(dateStr);
    
    if (log && log.flow !== 'none') {
      const yesterday = new Date(dateStr);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const yesterdayLog = logsByDate.get(yesterdayStr);
      if (!yesterdayLog || yesterdayLog.flow === 'none') {
        return 'start';
      }
      return 'during';
    }
    return 'none';
  };

  const changeMonth = (delta: number) => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const handleDayClick = (day: number) => {
    const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    setModalDate(dateStr);
    const existingLog = logsByDate.get(dateStr);
    setCurrentLog(existingLog || {
      date: dateStr,
      flow: 'none',
      pain: [],
      mood: [],
      notes: ''
    });
  };
  
  const handleSave = () => {
    if (currentLog) {
      onUpdateLog(currentLog);
    }
    setModalDate(null);
    setCurrentLog(null);
  };
  
  const handleFlowChange = (flow: MenstrualFlow) => {
    setCurrentLog(prev => prev ? {...prev, flow: prev.flow === flow ? 'none' : flow} : null);
  };

  const toggleSymptom = (type: 'pain' | 'mood', symptom: PainSymptom | MoodSymptom) => {
    setCurrentLog(prev => {
      if (!prev) return null;
      const currentSymptoms = prev[type] as (PainSymptom | MoodSymptom)[];
      const newSymptoms = currentSymptoms.includes(symptom as any)
        ? currentSymptoms.filter(s => s !== symptom)
        : [...currentSymptoms, symptom];
      return { ...prev, [type]: newSymptoms };
    });
  };

  const calendarDays = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarDays.push(<div key={`empty-${i}`} className="border-r border-b border-gray-800"></div>);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const status = getDayStatus(day);
    const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();
    
    let cellClasses = 'relative p-1.5 md:p-2 border-r border-b border-gray-800 flex justify-end items-start text-xs font-mono transition-colors duration-200 cursor-pointer ';

    if (status === 'start' || status === 'during') {
        cellClasses += 'bg-pink-950/40 hover:bg-pink-950/60 text-gray-300';
    } else {
        cellClasses += 'bg-[#111] hover:bg-gray-800/50 text-gray-500';
    }
    
    calendarDays.push(
      <div key={day} className={cellClasses} onClick={() => handleDayClick(day)}>
        <span className={isToday ? `text-pink-400 font-bold border-b-2 border-pink-500` : ''}>{day}</span>
        {status === 'start' && <div className="absolute bottom-1.5 left-1.5 w-2 h-2 bg-pink-400 rounded-full shadow-[0_0_5px_#f472b6]"></div>}
      </div>
    );
  }

  const currentYearForPicker = new Date().getFullYear();
  const yearOptions = Array.from({ length: 10 }, (_, i) => currentYearForPicker - i).reverse();

  return (
    <div className="flex flex-col h-full bg-[#050505] absolute inset-0 z-50 overflow-hidden font-mono">
        <div className="flex justify-between items-center p-4 border-b border-gray-800 bg-gray-900/50">
            <div className="flex items-center gap-2">
                <CalendarHeart className="text-pink-400" size={16}/>
                <span className="text-pink-400 font-bold text-sm tracking-widest">CYCLE_TRACKER</span>
            </div>
            <button onClick={onBack} className="text-gray-500 hover:text-white text-xs">[RETURN]</button>
        </div>

        <div className="p-4 border-b border-gray-800 relative">
            <div className="flex justify-between items-center">
                <button onClick={() => changeMonth(-1)} className="p-2 text-gray-500 hover:text-white"><ChevronLeft size={20} /></button>
                <button onClick={() => setIsDatePickerOpen(!isDatePickerOpen)} className="flex items-center gap-2 text-lg text-white font-bold tracking-wider hover:text-pink-300 transition-colors">
                    <span>{year} - {currentDate.toLocaleString('default', { month: 'long' })}</span>
                    <svg className={`w-4 h-4 transition-transform ${isDatePickerOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                <button onClick={() => changeMonth(1)} className="p-2 text-gray-500 hover:text-white"><ChevronRight size={20} /></button>
            </div>
            {isDatePickerOpen && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-20 bg-[#111] border border-pink-500/50 p-4 rounded-md shadow-lg w-64 animate-[fadeIn_0.2s] clip-corner-sm">
                    <div className="flex justify-between gap-4">
                        <div className="flex-1">
                            <label className="text-[10px] text-gray-400">Year</label>
                            <select
                                value={year}
                                onChange={(e) => {
                                    setCurrentDate(new Date(Number(e.target.value), month, 1));
                                }}
                                className="w-full bg-black border border-gray-700 text-white p-2 text-xs focus:border-pink-500 outline-none appearance-none"
                            >
                                {yearOptions.map(y => ( <option key={y} value={y}>{y}</option> ))}
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="text-[10px] text-gray-400">Month</label>
                            <select
                                value={month}
                                onChange={(e) => {
                                    setCurrentDate(new Date(year, Number(e.target.value), 1));
                                    setIsDatePickerOpen(false); // Close after selecting month
                                }}
                                className="w-full bg-black border border-gray-700 text-white p-2 text-xs focus:border-pink-500 outline-none appearance-none"
                            >
                                {Array.from({ length: 12 }, (_, i) => i).map(m => (
                                    <option key={m} value={m}>{new Date(0, m).toLocaleString('default', { month: 'long' })}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            )}
        </div>
        
        <div className="flex-1 grid grid-cols-7 text-center border-t border-gray-800">
            {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(day => (
                <div key={day} className="text-[10px] text-gray-600 p-2 border-b border-r border-gray-800">{day}</div>
            ))}
            {calendarDays}
        </div>

        {modalDate && currentLog && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center animate-[fadeIn_0.2s] z-50 p-4">
                <div className="w-full max-w-sm bg-[#0a0a0a] border border-pink-500/50 clip-corner-sm shadow-[0_0_20px_rgba(244,114,182,0.2)]">
                    <div className="p-4 border-b border-pink-900/50 flex justify-between items-center">
                        <h4 className="text-white font-bold">{modalDate}</h4>
                        <button onClick={() => setModalDate(null)} className="text-gray-500 hover:text-white"><X size={16}/></button>
                    </div>
                    <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
                        <div className="space-y-2">
                            <label className="text-xs text-pink-400 font-bold tracking-widest">流量 (FLOW)</label>
                            <div className="flex flex-wrap gap-2">
                                {FLOW_LEVELS.map(level => (
                                    <button key={level} onClick={() => handleFlowChange(level)} className={`px-3 py-1 text-xs border clip-corner-sm transition-all ${currentLog.flow === level ? 'bg-pink-500 text-black border-pink-400' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-pink-500'}`}>{FLOW_LABELS[level]}</button>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs text-pink-400 font-bold tracking-widest">疼痛 (PAIN)</label>
                            <div className="flex flex-wrap gap-2">
                                {PAIN_SYMPTOMS.map(symptom => (
                                    <button key={symptom} onClick={() => toggleSymptom('pain', symptom)} className={`px-3 py-1 text-xs border clip-corner-sm transition-all ${currentLog.pain.includes(symptom) ? 'bg-pink-500 text-black border-pink-400' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-pink-500'}`}>{SYMPTOM_LABELS[symptom]}</button>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs text-pink-400 font-bold tracking-widest">情绪 (MOOD)</label>
                            <div className="flex flex-wrap gap-2">
                                {MOOD_SYMPTOMS.map(symptom => (
                                    <button key={symptom} onClick={() => toggleSymptom('mood', symptom)} className={`px-3 py-1 text-xs border clip-corner-sm transition-all ${currentLog.mood.includes(symptom) ? 'bg-pink-500 text-black border-pink-400' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-pink-500'}`}>{SYMPTOM_LABELS[symptom]}</button>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2">
                           <label className="text-xs text-pink-400 font-bold tracking-widest">笔记 (NOTES)</label>
                           <textarea value={currentLog.notes} onChange={(e) => setCurrentLog(prev => prev ? {...prev, notes: e.target.value} : null)} placeholder="..." className="w-full h-20 bg-black border border-gray-700 text-gray-300 p-2 text-sm font-mono focus:border-pink-500 outline-none resize-none placeholder-gray-800"/>
                        </div>
                    </div>
                     <div className="p-4 border-t border-pink-900/50">
                        <button onClick={handleSave} className="w-full text-center py-3 text-sm border clip-corner-sm transition-all uppercase font-bold bg-pink-800 border-pink-700 text-white hover:bg-pink-700">
                            Save Log
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default CycleTracker;
