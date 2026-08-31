import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { SparklesIcon, XMarkIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { AI_MICROCOPY } from '../config/theme';

/**
 * AI Assistant floating bubble (purple — SOW premium UI).
 * Purple denotes AI. Provides quick, context-aware guidance and jump links.
 * (Conversational answers use local guidance; deep analysis stays in
 * RedefineYourArch which is Bedrock-powered.)
 */

interface Msg { role: 'user' | 'assistant'; text: string; }

export default function AiAssistant() {
  const navigate = useNavigate();
  const { scanResult, analysisResult } = useAppStore();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: 'Hi! I can help you navigate ArchLens. Ask about discovery, WAF analysis, cost, or remediation.' },
  ]);

  function answer(q: string): string {
    const s = q.toLowerCase();
    if (s.includes('scan') || s.includes('discover')) {
      return scanResult
        ? `Your latest scan found ${scanResult.summary.total_resources} resources across ${scanResult.regions.join(', ')}. Open YourArch to view the diagram.`
        : 'Go to YourArch, enter your read-only IAM role ARN and region, then click Discover Architecture.';
    }
    if (s.includes('waf') || s.includes('analy') || s.includes('recommend')) {
      return analysisResult
        ? `Analysis is ready with ${analysisResult.analysis.recommendations?.length || 0} recommendations and an overall score of ${analysisResult.analysis.overall_score ?? 'N/A'}. See RedefineYourArch.`
        : 'Open RedefineYourArch, pick the WAF pillars you care about, and click Analyze Architecture.';
    }
    if (s.includes('cost')) {
      return 'Switch the diagram to the Cost view in YourArch to size resources by monthly spend, and check the Cost Trend on the Dashboard.';
    }
    if (s.includes('drift')) {
      return 'InsightHub → Drift Detection compares your two most recent scans and flags added/removed/changed resources.';
    }
    if (s.includes('deploy') || s.includes('remediat') || s.includes('backup')) {
      return 'AutoRemediate takes backups first, shows a Change Set preview, then deploys with automatic rollback on failure.';
    }
    if (s.includes('report') || s.includes('pdf')) {
      return 'InsightHub → Executive Report (PDF) generates a leadership summary of health score, footprint, and top recommendations.';
    }
    return 'I can help with discovery, WAF analysis, cost views, drift detection, remediation, and reports. Try asking about any of those.';
  }

  function send() {
    const q = input.trim();
    if (!q) return;
    const reply = answer(q);
    setMessages((m) => [...m, { role: 'user', text: q }, { role: 'assistant', text: reply }]);
    setInput('');
  }

  return (
    <>
      {/* Floating bubble */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-white transition-transform hover:scale-105"
        style={{ background: 'linear-gradient(135deg, #1A56DB 0%, #8B5CF6 100%)' }}
        title="AI Assistant"
      >
        {open ? <XMarkIcon className="w-6 h-6" /> : <SparklesIcon className="w-6 h-6" />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-80 bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '60vh' }}>
          <div className="px-4 py-3 border-b border-dark-700 flex items-center gap-2" style={{ background: 'linear-gradient(135deg, rgba(26,86,219,0.15), rgba(139,92,246,0.15))' }}>
            <SparklesIcon className="w-5 h-5 text-purple-400" />
            <div>
              <p className="text-sm font-semibold text-white">ArchLens Assistant</p>
              <p className="text-[10px] text-purple-400/70">{AI_MICROCOPY}</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] text-sm px-3 py-2 rounded-2xl ${
                  m.role === 'user' ? 'bg-primary-500 text-white' : 'bg-dark-900 text-gray-200 border border-dark-700'
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-dark-700 flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Ask about ArchLens…"
              className="flex-1 bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-purple-500"
            />
            <button onClick={send} className="p-2 rounded-lg text-white" style={{ background: 'linear-gradient(135deg, #1A56DB 0%, #8B5CF6 100%)' }}>
              <PaperAirplaneIcon className="w-4 h-4" />
            </button>
          </div>
          <button onClick={() => navigate('/redefine')} className="text-[11px] text-purple-400 hover:text-purple-300 pb-3 text-center">
            Open full AI analysis →
          </button>
        </div>
      )}
    </>
  );
}
