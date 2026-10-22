import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { chatWithAI } from '../services/api';
import {
  SparklesIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  TrashIcon,
  ArrowTopRightOnSquareIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
  model?: string;
}

const STARTER_PROMPTS = [
  '🛡️ How can I harden security in my account?',
  '💰 Where can I reduce AWS costs right now?',
  '📊 Summarize my discovered architecture',
  '⚡ How to make my databases Multi-AZ resilient?',
];

export default function AiAssistant() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    scanResult,
    savedScans,
    analysisResult,
    cftTemplate,
    terraformScript,
    backupResult,
  } = useAppStore();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'assistant',
      text: "👋 **Hello! I'm your ArchLens AI Solutions Architect**, powered live by **Amazon Bedrock**.\n\nAsk me anything about your discovered architecture, security hardening, cost optimizations, or Well-Architected Framework guidelines across any section of the platform.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, open]);

  async function handleSend(textToSend?: string) {
    const q = (textToSend || input).trim();
    if (!q || isTyping) return;

    const userMsg: Msg = {
      role: 'user',
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const activeScanId = scanResult?.scanId || (savedScans && savedScans.length > 0 ? savedScans[0].scanId : undefined);
      const activeScanTimestamp = scanResult?.timestamp || (savedScans && savedScans.length > 0 ? savedScans[0].timestamp : undefined);

      // Call backend Amazon Bedrock through /analyze chat action with complete live context
      const res = await chatWithAI({
        question: q,
        scanId: activeScanId,
        scanTimestamp: activeScanTimestamp,
        recentScans: (savedScans || []).slice(0, 10).map((s) => ({
          scanNumber: s.scanNumber,
          scanId: s.scanId,
          timestamp: s.timestamp,
          resourceCount: s.resourceCount,
          region: s.region,
          accountId: s.accountId,
        })),
        architectureData: scanResult || undefined,
        analysisData: analysisResult ? {
          overallScore: analysisResult.analysis?.overall_score,
          pillarScores: analysisResult.analysis?.pillar_scores,
          costAnalysis: analysisResult.analysis?.cost_analysis,
          riskSummary: analysisResult.analysis?.risk_summary,
          recommendationCount: analysisResult.analysis?.recommendations?.length,
          topRecommendations: (analysisResult.analysis?.recommendations || []).slice(0, 6).map((r) => ({
            id: r.id,
            title: r.title,
            pillar: r.pillar,
            priority: r.priority,
            monthly_cost_impact: r.monthly_cost_impact,
            affected_resources: r.affected_resources,
            description: r.description,
          })),
        } : undefined,
        remediationStatus: {
          hasCft: !!cftTemplate,
          hasTerraform: !!terraformScript,
          hasBackup: !!backupResult,
        },
        activeSection: location.pathname,
        chatHistory: messages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
      });

      if (res.data?.reply) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: res.data.reply,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            model: res.data.model_used || 'Amazon Nova Pro',
          },
        ]);
      } else {
        const errDetail = res.error || "Unable to reach Amazon Bedrock. Please check your backend connection or retry.";
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: `⚠️ **AI Service Notice**: ${errDetail}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: "I encountered a network issue communicating with the ArchLens AI service. Please verify your connection or try again in a moment.",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }

  function handleClear() {
    setMessages([
      {
        role: 'assistant',
        text: "Chat cleared. What would you like to review about your AWS architecture?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  }

  // Format markdown bolding and bullet lists cleanly
  function renderFormattedText(txt: string) {
    const lines = txt.split('\n');
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return <div key={idx} className="h-1.5" />;

      // Bullet points
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const content = trimmed.substring(2);
        return (
          <div key={idx} className="flex items-start gap-1.5 text-xs my-0.5 pl-1 text-gray-200">
            <span className="text-primary-400 mt-0.5">•</span>
            <span dangerouslySetInnerHTML={{ __html: formatInline(content) }} />
          </div>
        );
      }

      // Headers (### or ##)
      if (trimmed.startsWith('### ') || trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
        const headerText = trimmed.replace(/^#+\s*/, '');
        return (
          <p key={idx} className="text-xs font-bold text-primary-300 mt-2 mb-1">
            {headerText}
          </p>
        );
      }

      return (
        <p
          key={idx}
          className="text-xs text-gray-200 leading-relaxed my-0.5"
          dangerouslySetInnerHTML={{ __html: formatInline(trimmed) }}
        />
      );
    });
  }

  function formatInline(str: string): string {
    return str
      .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="text-primary-200">$1</em>')
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-dark-950 rounded text-primary-300 font-mono text-[11px]">$1</code>');
  }

  return (
    <>
      {/* Floating Action Bubble */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-white transition-all duration-300 hover:scale-105 active:scale-95 focus:outline-none"
        style={{
          background: 'linear-gradient(135deg, #4338ca 0%, #7e22ce 50%, #9333ea 100%)',
          boxShadow: '0 8px 24px -4px rgba(126, 34, 206, 0.5)',
        }}
        title="ArchLens AI Solutions Architect"
        aria-label="Open AI Assistant"
      >
        {open ? <XMarkIcon className="w-6 h-6" /> : <SparklesIcon className="w-6 h-6 animate-pulse" />}
      </button>

      {/* Floating Chat Modal */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-3rem)] bg-dark-900 border border-primary-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-fade-in"
          style={{ height: '540px', maxHeight: '75vh' }}
        >
          {/* Header */}
          <div
            className="px-4 py-3 border-b border-dark-700 flex items-center justify-between"
            style={{
              background: 'linear-gradient(135deg, rgba(67, 56, 202, 0.25) 0%, rgba(147, 51, 234, 0.25) 100%)',
            }}
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-primary-600/30 border border-primary-400/40 rounded-lg">
                <SparklesIcon className="w-4 h-4 text-primary-300" />
              </div>
              <div>
                <p className="text-sm font-bold text-white flex items-center gap-1.5">
                  ArchLens AI
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary-500/20 text-primary-300 border border-primary-500/30 flex items-center gap-0.5">
                    <CpuChipIcon className="w-2.5 h-2.5" /> Amazon Bedrock
                  </span>
                </p>
                <p className="text-[10px] text-gray-400">
                  {scanResult
                    ? `Context: ${scanResult.summary.total_resources} resources discovered`
                    : 'Ready for architecture Q&A'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleClear}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-dark-800 transition-colors"
                title="Clear conversation"
              >
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-dark-800 transition-colors"
                title="Close"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Active Context Banner */}
          {scanResult && (
            <div className="bg-dark-950/80 px-3 py-1.5 border-b border-dark-800 text-[10px] text-gray-400 flex items-center justify-between">
              <span className="truncate">
                Account: <code className="text-primary-300">{scanResult.accountId}</code> ({scanResult.regions.join(', ')})
              </span>
              <button
                onClick={() => navigate('/redefine')}
                className="text-primary-400 hover:text-primary-300 flex items-center gap-0.5 flex-shrink-0 ml-2"
              >
                Full Analysis <ArrowTopRightOnSquareIcon className="w-2.5 h-2.5" />
              </button>
            </div>
          )}

          {/* Message List */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs shadow-md ${
                    m.role === 'user'
                      ? 'bg-primary-600 text-white rounded-br-xs'
                      : 'bg-dark-800 text-gray-200 border border-dark-700/80 rounded-bl-xs'
                  }`}
                >
                  {m.role === 'user' ? (
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  ) : (
                    renderFormattedText(m.text)
                  )}
                </div>
                {m.timestamp && (
                  <span className="text-[9px] text-gray-500 mt-1 px-1">
                    {m.timestamp} {m.model ? `• ${m.model}` : ''}
                  </span>
                )}
              </div>
            ))}

            {/* Typing indicator */}
            {isTyping && (
              <div className="flex items-start gap-2">
                <div className="bg-dark-800 border border-dark-700/80 rounded-2xl rounded-bl-xs px-3.5 py-2 text-xs flex items-center gap-1.5 text-primary-300">
                  <SparklesIcon className="w-3.5 h-3.5 animate-spin" />
                  <span>Bedrock is thinking...</span>
                  <div className="flex gap-1 ml-1">
                    <span className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Starter Suggestions */}
          {messages.length <= 2 && !isTyping && (
            <div className="px-3 pb-2 pt-1 border-t border-dark-800 flex flex-wrap gap-1.5 bg-dark-950/40">
              {STARTER_PROMPTS.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(prompt)}
                  className="text-[10px] px-2 py-1 rounded-full bg-dark-800 hover:bg-primary-900/40 border border-dark-700 hover:border-primary-500/50 text-gray-300 hover:text-primary-200 transition-colors text-left"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {/* Input Footer */}
          <div className="p-3 border-t border-dark-700 bg-dark-900 flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Ask Amazon Bedrock about your architecture…"
              disabled={isTyping}
              className="flex-1 bg-dark-950 border border-dark-700 focus:border-primary-500 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none transition-colors"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isTyping}
              className="p-2 rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed transition-transform active:scale-95"
              style={{ background: 'linear-gradient(135deg, #4338ca 0%, #9333ea 100%)' }}
              title="Send message"
            >
              <PaperAirplaneIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
