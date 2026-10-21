import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  AgentStatus, 
  ActivityItem, 
  ChatMessage, 
  DiffItem, 
  ExecutionMode, 
  PendingApproval 
} from '../types/agent';
import { ModelOption } from '../types/models';
import { ExtensionToWebviewMessage } from '../types/messages';
import { MarkdownView } from './MarkdownView';

declare const acquireVsCodeApi: () => {
  postMessage: (msg: any) => void;
};

const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : { postMessage: () => {} };

function getDynamicModelsForKeys(keys: Record<string, boolean>) {
  const list: Array<{ id: string; name: string }> = [];

  if (keys.nvidia) {
    list.push(
      { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', name: '⚡ Nemotron 3.5 Lightning (Reasoning)' },
      { id: 'nvidia/nemotron-3-ultra-550b-a55b', name: '🧠 Nemotron 3 Ultra 550B (Deep Think)' },
      { id: 'stepfun-ai/step-5-preview', name: '🚀 StepFun 5 Preview (Coding)' }
    );
  }
  if (keys.groq) {
    list.push(
      { id: 'groq/qwen3.8-27b', name: '⚡ Groq Qwen 3.8 27B (750 tok/s)' },
      { id: 'groq/gpt-oss-120b', name: '🧠 Groq GPT-OSS 120B (High Intelligence)' },
      { id: 'groq/gpt-oss-20b', name: '⚡ Groq GPT-OSS 20B (Instant Speed)' }
    );
  }
  if (keys.openrouter || list.length === 0) {
    list.push(
      { id: 'openrouter/free', name: '🌐 OpenRouter Auto Free (Always Active)' }
    );
  }
  return list;
}

export const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [mode, setMode] = useState<ExecutionMode>('turbo');
  const [currentModel, setCurrentModel] = useState<string>('nvidia/nemotron-3.5-lightning-30b-a3b');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [hasKey, setHasKey] = useState<boolean>(true);
  const [workspaceName, setWorkspaceName] = useState<string>('');
  
  // Active streaming state
  const [streamingThought, setStreamingThought] = useState<string>('');
  const [isThoughtStreaming, setIsThoughtStreaming] = useState<boolean>(false);
  const [thoughtStartTime, setThoughtStartTime] = useState<number>(0);
  const [thoughtDuration, setThoughtDuration] = useState<number>(0);
  const [isThoughtExpanded, setIsThoughtExpanded] = useState<boolean>(false);

  const [streamingContent, setStreamingContent] = useState<string>('');
  const [activeActivities, setActiveActivities] = useState<ActivityItem[]>([]);
  const [activeDiffs, setActiveDiffs] = useState<DiffItem[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  // Settings & Input
  const [prompt, setPrompt] = useState<string>('');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState<boolean>(false);
  const [modelSearchQuery, setModelSearchQuery] = useState<string>('');
  const [isFetchingModels, setIsFetchingModels] = useState<boolean>(false);
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, boolean>>({});
  const [singleKeyInput, setSingleKeyInput] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [keySaveSuccess, setKeySaveSuccess] = useState<boolean>(false);

  // User configurable models
  const [userModels, setUserModels] = useState<Array<{ id: string; name: string }>>(() => {
    return [
      { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', name: '⚡ Nemotron 3.5 Lightning (Reasoning)' },
      { id: 'nvidia/nemotron-3-ultra-550b-a55b', name: '🧠 Nemotron 3 Ultra 550B (Deep Think)' },
      { id: 'groq/qwen3.8-27b', name: '⚡ Groq Qwen 3.8 27B (750 tok/s)' },
      { id: 'groq/gpt-oss-120b', name: '🧠 Groq GPT-OSS 120B (High Intelligence)' },
      { id: 'openrouter/free', name: '🌐 OpenRouter Auto Free' }
    ];
  });

  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    vscode.postMessage({ type: 'REQUEST_INIT_STATE' });

    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'INIT_STATE':
          setStatus(msg.payload.status);
          setMode(msg.payload.mode);
          setAvailableModels(msg.payload.availableModels);
          setHasKey(msg.payload.hasKey);
          setMessages(msg.payload.messages);
          if (msg.payload.configuredKeys) {
            setConfiguredKeys(msg.payload.configuredKeys);
            const dynamic = getDynamicModelsForKeys(msg.payload.configuredKeys);
            if (dynamic.length > 0) {
              setUserModels(dynamic);
              if (!dynamic.some(m => m.id === msg.payload.currentModel)) {
                setCurrentModel(dynamic[0].id);
              } else {
                setCurrentModel(msg.payload.currentModel);
              }
            }
          }
          if (msg.payload.workspaceName) {
            setWorkspaceName(msg.payload.workspaceName);
          }
          if (!msg.payload.hasKey) {
            setIsSettingsOpen(true);
          }
          break;

        case 'STATUS_CHANGE':
          setStatus(msg.payload.status);
          if (msg.payload.status === 'completed' || msg.payload.status === 'idle') {
            setIsThoughtStreaming(false);
          }
          break;

        case 'STREAM_THOUGHT':
          if (msg.payload.isComplete) {
            setIsThoughtStreaming(false);
            setIsThoughtExpanded(false); // Smoothly collapse when done!
            setThoughtDuration(Math.round((Date.now() - (thoughtStartTime || Date.now())) / 100) / 10);
          } else if (msg.payload.chunk) {
            setIsThoughtStreaming(true);
            setIsThoughtExpanded(false); // Collapsed by default as requested!
            if (!thoughtStartTime) {
              setThoughtStartTime(Date.now());
            }
            setStreamingThought(prev => prev + msg.payload.chunk);
          }
          break;

        case 'STREAM_CONTENT':
          setStreamingContent(prev => prev + msg.payload.chunk);
          break;

        case 'ACTIVITY_UPDATE': {
          const act = msg.payload.activity;
          setActiveActivities(prev => {
            const idx = prev.findIndex(a => a.id === act.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = act;
              return updated;
            }
            return [...prev, act];
          });
          break;
        }

        case 'DIFF_UPDATE':
          setActiveDiffs(prev => [...prev, msg.payload.diff]);
          break;

        case 'REQUEST_APPROVAL':
          setPendingApproval(msg.payload.approval);
          break;

        case 'MESSAGE_COMPLETE':
          setMessages(prev => [...prev, msg.payload.message]);
          // Reset turn stream state
          setStreamingThought('');
          setStreamingContent('');
          setActiveActivities([]);
          setActiveDiffs([]);
          setIsThoughtStreaming(false);
          setIsThoughtExpanded(false);
          break;

        case 'MODELS_FETCHED':
          if (msg.payload.models && msg.payload.models.length > 0) {
            setUserModels(msg.payload.models);
            try {
              localStorage.setItem('jarvis_user_models_v2', JSON.stringify(msg.payload.models));
            } catch {}
            setIsFetchingModels(false);
          }
          break;

        case 'SHOW_ERROR':
          setErrorMessage(msg.payload.message);
          setIsFetchingModels(false);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [thoughtStartTime]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, streamingThought, activeActivities, pendingApproval]);

  const handleSend = () => {
    if (!prompt.trim() || status === 'reasoning' || status === 'executing_tool') {
      return;
    }
    const text = prompt;
    setPrompt('');
    setErrorMessage(null);
    setStreamingThought('');
    setStreamingContent('');
    setActiveActivities([]);
    setActiveDiffs([]);
    setIsThoughtStreaming(false);
    setIsThoughtExpanded(false);
    setThoughtStartTime(0);

    vscode.postMessage({
      type: 'SEND_PROMPT',
      payload: { text }
    });
  };

  const handleCancel = () => {
    vscode.postMessage({ type: 'CANCEL_TASK' });
  };

  const handleModeChange = (newMode: ExecutionMode) => {
    setMode(newMode);
    vscode.postMessage({ type: 'SET_MODE', payload: { mode: newMode } });
  };

  const handleModelChange = (modelId: string) => {
    setCurrentModel(modelId);
    vscode.postMessage({ type: 'SET_MODEL', payload: { modelId } });
  };

  const detectedProvider = useMemo(() => {
    const k = singleKeyInput.trim();
    if (!k) return null;
    if (k.startsWith('nvapi-')) return { name: 'NVIDIA NIM (Free Reasoning)', type: 'nvidia', color: '#76b900' };
    if (k.startsWith('gsk_')) return { name: 'Groq Cloud (500 tok/s Free)', type: 'groq', color: '#f55036' };
    if (k.startsWith('sk-or-')) return { name: 'OpenRouter Universal', type: 'openrouter', color: '#6366f1' };
    if (k.startsWith('AIza')) return { name: 'Google Gemini', type: 'gemini', color: '#38bdf8' };
    if (k.startsWith('sk-')) return { name: 'OpenAI API', type: 'openai', color: '#10b981' };
    return { name: 'API Key', type: 'openrouter', color: '#0099ff' };
  }, [singleKeyInput]);

  const handleSaveKey = () => {
    const val = singleKeyInput.trim();
    if (!val) {
      setIsSettingsOpen(false);
      return;
    }

    const keysToSave: any = {};
    if (val.startsWith('nvapi-')) {
      keysToSave.nvidia = val;
    } else if (val.startsWith('gsk_')) {
      keysToSave.groq = val;
    } else if (val.startsWith('AIza')) {
      keysToSave.gemini = val;
    } else if (val.startsWith('sk-ant-')) {
      keysToSave.anthropic = val;
    } else {
      keysToSave.openrouter = val;
    }

    vscode.postMessage({
      type: 'SAVE_KEYS',
      payload: { keys: keysToSave }
    });

    const newConfigured = { 
      ...configuredKeys, 
      [keysToSave.nvidia ? 'nvidia' : (keysToSave.groq ? 'groq' : 'openrouter')]: true 
    };
    setConfiguredKeys(newConfigured);
    const newModels = getDynamicModelsForKeys(newConfigured);
    setUserModels(newModels);

    if (newModels.length > 0 && !newModels.some(m => m.id === currentModel)) {
      handleModelChange(newModels[0].id);
    }

    setHasKey(true);
    setKeySaveSuccess(true);
    setSingleKeyInput('');
    setTimeout(() => {
      setKeySaveSuccess(false);
      setIsSettingsOpen(false);
    }, 800);
  };

  const handleClearKeys = () => {
    vscode.postMessage({
      type: 'SAVE_KEYS',
      payload: { keys: { openrouter: '', nvidia: '', groq: '', gemini: '', openai: '', anthropic: '' } }
    });
    setConfiguredKeys({});
    const defaultList = getDynamicModelsForKeys({});
    setUserModels(defaultList);
    setHasKey(false);
    setSingleKeyInput('');
  };

  const handleApproval = (approved: boolean) => {
    if (pendingApproval) {
      vscode.postMessage({
        type: 'RESOLVE_APPROVAL',
        payload: { approvalId: pendingApproval.id, approved }
      });
      setPendingApproval(null);
    }
  };

  const handleRollbackAll = () => {
    vscode.postMessage({ type: 'ROLLBACK_ALL' });
  };

  const handleNewSession = () => {
    setMessages([]);
    setStreamingThought('');
    setStreamingContent('');
    setActiveActivities([]);
    setActiveDiffs([]);
    vscode.postMessage({ type: 'NEW_SESSION' });
  };

  const handleLinkClick = (url: string) => {
    vscode.postMessage({ type: 'OPEN_LINK', payload: { url } });
  };

  const handleFetchLiveModels = () => {
    setIsFetchingModels(true);
    vscode.postMessage({ type: 'FETCH_MODELS' });
  };

  const getSensedKeyStatus = () => {
    const anyKeyConfigured = hasKey || Object.values(configuredKeys).some(Boolean);
    if (!anyKeyConfigured) {
      return { text: 'API Key Required ⚠️', ready: false };
    }
    if (configuredKeys.nvidia && configuredKeys.groq) {
      return { text: 'NVIDIA + Groq Ready ⚡', ready: true };
    }
    if (configuredKeys.nvidia) {
      return { text: 'NVIDIA NIM Active ✓', ready: true };
    }
    if (configuredKeys.groq) {
      return { text: 'Groq Active ⚡', ready: true };
    }
    if (configuredKeys.openrouter) {
      return { text: 'OpenRouter Ready ✓', ready: true };
    }
    return { text: 'Key Active ✓', ready: true };
  };

  const sensedStatus = getSensedKeyStatus();

  return (
    <div className="app-container">
      {/* Top Navigation */}
      <header className="top-nav">
        <div className="nav-title">{workspaceName || 'Casual Greeting'}</div>
        <div className="nav-actions">
          <button className="nav-pill-btn" onClick={handleRollbackAll} title="Time Machine: Undo all changes from session">
            ↺ Rollback
          </button>
          <button className="nav-pill-btn" onClick={handleNewSession} title="Start New Session">
            + New
          </button>
          <button className="nav-pill-btn" onClick={() => setIsSettingsOpen(true)} title="API Key Settings">
            ⚙ {hasKey ? 'Key Set' : 'Set Key'}
          </button>
        </div>
      </header>

      {/* Chat Messages Feed */}
      <div className="chat-feed">
        {messages.length === 0 && !streamingThought && !streamingContent && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '48px', padding: '0 20px' }}>
            <div style={{ 
              fontFamily: 'var(--font-sans)', 
              color: '#ffffff', 
              fontSize: '16px', 
              fontWeight: 600, 
              letterSpacing: '-0.01em', 
              marginBottom: '6px' 
            }}>
              Ask anything, @ to mention, / for actions
            </div>
            <div style={{ fontSize: '13px', lineHeight: '1.65', color: 'var(--text-muted)', maxWidth: '340px', margin: '0 auto' }}>
              Instruct JARVIS to inspect code, build features, run tests, or execute surgical diff edits.
            </div>
          </div>
        )}

        {messages.map((msg) => (
          msg.role === 'user' ? (
            <div key={msg.id} className="user-card-wrapper">
              <div className="message-user">{msg.content}</div>
            </div>
          ) : (
            <div key={msg.id} className="message-assistant">
              {/* Persisted Thinking Accordion */}
              {msg.thoughts && msg.thoughts.length > 0 && msg.thoughts.map(t => (
                <PersistedThoughtBox key={t.id} thought={t} />
              ))}

              {/* Activities */}
              {msg.activities && msg.activities.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', margin: '4px 0' }}>
                  {msg.activities.map(act => (
                    <ActivityCard key={act.id} activity={act} />
                  ))}
                </div>
              )}

              {/* Diffs */}
              {msg.diffs && msg.diffs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {msg.diffs.map((diff, i) => (
                    <DiffCard key={i} diff={diff} />
                  ))}
                </div>
              )}

              {/* Main content */}
              {msg.content && (
                <div className="assistant-text">
                  <MarkdownView content={msg.content} onLinkClick={handleLinkClick} />
                </div>
              )}

              <div className="message-meta-bar">
                <span>just now</span>
                <button 
                  className="meta-icon-btn" 
                  onClick={() => navigator.clipboard.writeText(msg.content)} 
                  title="Copy response"
                >
                  ⎘
                </button>
              </div>
            </div>
          )
        ))}

        {/* Live Turn Underway */}
        {(streamingThought || streamingContent || activeActivities.length > 0) && (
          <div className="message-assistant">
            {/* Live Minimal Thinking Row (Exact from Image 2) */}
            {streamingThought && streamingThought.trim().length > 0 && (
              <div className="minimal-thought-container">
                <div 
                  className="minimal-thought-row"
                  onClick={() => setIsThoughtExpanded(!isThoughtExpanded)}
                >
                  {isThoughtStreaming ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="pulse-dot" />
                      <span className="thought-label">Thinking...</span>
                      <span className="thought-arrow">{isThoughtExpanded ? '▾' : '›'}</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="thought-label">Thought for {thoughtDuration > 0 ? thoughtDuration + 's' : 'a moment'}</span>
                      <span className="thought-arrow">{isThoughtExpanded ? '▾' : '›'}</span>
                    </div>
                  )}
                </div>
                {isThoughtExpanded && (
                  <div className="minimal-thought-drawer">
                    {streamingThought}
                  </div>
                )}
              </div>
            )}

            {/* Live Activities */}
            {activeActivities.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {activeActivities.map(act => (
                  <ActivityCard key={act.id} activity={act} />
                ))}
              </div>
            )}

            {/* Live Diffs */}
            {activeDiffs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {activeDiffs.map((diff, i) => (
                  <DiffCard key={i} diff={diff} />
                ))}
              </div>
            )}

            {/* Live Content Stream */}
            {streamingContent && (
              <div className="assistant-text">
                <MarkdownView content={streamingContent} onLinkClick={handleLinkClick} />
              </div>
            )}
          </div>
        )}

        {/* Pending Approval Banner */}
        {pendingApproval && (
          <div className="approval-card">
            <div style={{ fontWeight: 600, color: 'var(--amber-accent)', fontSize: '12px' }}>
              Action Approval Required
            </div>
            <div style={{ fontSize: '12px' }}>
              {pendingApproval.description}
            </div>
            {pendingApproval.commandOrPath && (
              <code style={{ background: '#000', padding: '4px 6px', borderRadius: '4px', fontSize: '11px' }}>
                {pendingApproval.commandOrPath}
              </code>
            )}
            <div className="approval-actions">
              <button className="btn-deny" onClick={() => handleApproval(false)}>Reject</button>
              <button className="btn-approve" onClick={() => handleApproval(true)}>Approve & Run</button>
            </div>
          </div>
        )}

        {/* Error notification */}
        {errorMessage && (
          <div style={{ background: 'rgba(255, 82, 82, 0.1)', border: '1px solid var(--red-accent)', padding: '8px 10px', borderRadius: '6px', color: '#ff8a80', fontSize: '12px' }}>
            {errorMessage}
          </div>
        )}

        <div ref={feedEndRef} />
      </div>

      {/* Antigravity Floating Stadium Composer */}
      <footer className="composer-container">
        <div className="composer-box">
          <textarea
            className="composer-textarea"
            rows={2}
            placeholder="Ask anything, @ to mention, / for actions"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="composer-bottom-bar">
            <div className="composer-bar-left" style={{ position: 'relative' }}>
              <button 
                className="composer-pill-btn" 
                onClick={() => setIsSettingsOpen(true)} 
                title="Configure Models & Keys"
              >
                +
              </button>
              <button 
                className="model-pill-select" 
                style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                title="Select model"
              >
                <span>{userModels.find(m => m.id === currentModel)?.name || currentModel}</span>
                <span className="dropdown-arrow">▾</span>
              </button>

              {/* Floating Model Popover with Real-Time Search & Live Provider Fetch */}
              {isModelMenuOpen && (
                <div className="model-popover">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 14px 4px' }}>
                    <span className="model-popover-header" style={{ padding: 0 }}>
                      Model ({userModels.filter(m => m.name.toLowerCase().includes(modelSearchQuery.toLowerCase()) || m.id.toLowerCase().includes(modelSearchQuery.toLowerCase())).length})
                    </span>
                    <button 
                      onClick={handleFetchLiveModels} 
                      disabled={isFetchingModels}
                      style={{ 
                        background: 'rgba(255, 255, 255, 0.05)', 
                        border: '1px solid rgba(255, 255, 255, 0.1)', 
                        color: 'var(--text-secondary)', 
                        borderRadius: '4px', 
                        padding: '2px 7px', 
                        fontSize: '10.5px', 
                        cursor: 'pointer' 
                      }}
                      title="Fetch live models from your API key provider"
                    >
                      {isFetchingModels ? '⟳ Fetching...' : '🔄 Fetch Live'}
                    </button>
                  </div>

                  <div style={{ padding: '4px 10px 6px' }}>
                    <input 
                      type="text" 
                      placeholder="Search models..." 
                      value={modelSearchQuery}
                      onChange={(e) => setModelSearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        background: '#131314',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        fontSize: '11px',
                        color: '#fff',
                        outline: 'none'
                      }}
                    />
                  </div>

                  <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                    {userModels
                      .filter(m => m.name.toLowerCase().includes(modelSearchQuery.toLowerCase()) || m.id.toLowerCase().includes(modelSearchQuery.toLowerCase()))
                      .map(m => (
                        <div 
                          key={m.id}
                          className={`model-popover-item ${currentModel === m.id ? 'active' : ''}`}
                          onClick={() => {
                            handleModelChange(m.id);
                            setIsModelMenuOpen(false);
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }} title={m.id}>
                            {m.name}
                          </span>
                          {currentModel === m.id && <span style={{ color: '#0099ff', fontWeight: 'bold' }}>✓</span>}
                        </div>
                      ))}
                  </div>

                  <div className="model-popover-footer">
                    <button 
                      className="model-popover-footer-btn" 
                      onClick={() => {
                        setIsModelMenuOpen(false);
                        setIsSettingsOpen(true);
                      }}
                    >
                      <span>⚙ Configure Models & Keys</span>
                      <span>›</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="composer-bar-right">
              <button 
                className="mode-pill-btn"
                onClick={() => handleModeChange(mode === 'turbo' ? 'general' : 'turbo')}
                title="Toggle Mode"
              >
                <span>🛡</span>
                <span>{mode === 'turbo' ? 'Turbo' : 'Safe'}</span>
                <span style={{ fontSize: '9px', opacity: 0.6 }}>▾</span>
              </button>

              {status === 'reasoning' || status === 'executing_tool' ? (
                <button className="circle-action-btn stop-action" onClick={handleCancel} title="Stop generation">
                  ■
                </button>
              ) : (
                <button 
                  className={`circle-action-btn ${prompt.trim() ? 'send-active' : 'send-disabled'}`} 
                  onClick={handleSend} 
                  disabled={!prompt.trim()}
                  title="Send message"
                  style={prompt.trim() ? { background: '#0099ff', color: '#ffffff', boxShadow: '0 0 12px rgba(0, 153, 255, 0.4)' } : {}}
                >
                  ➔
                </button>
              )}
            </div>
          </div>
        </div>
      </footer>

      {/* Ultra-Minimal Aesthetic Key Modal */}
      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '370px', borderRadius: '12px', padding: '18px', background: '#121316', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 16px 40px rgba(0,0,0,0.6)' }} onClick={e => e.stopPropagation()}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>
                Connect API Key
              </div>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '14px', lineHeight: 1.4 }}>
              Paste your <b>NVIDIA NIM</b> (<code>nvapi-...</code>) or <b>Groq</b> (<code>gsk_...</code>) API key. JARVIS auto-detects it and configures your models automatically.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input 
                type="password"
                placeholder="Paste API key here (nvapi-... or gsk_...)"
                value={singleKeyInput}
                onChange={(e) => setSingleKeyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey(); }}
                autoFocus
                style={{
                  background: '#0a0a0c',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#fff',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  outline: 'none',
                  fontFamily: 'monospace',
                  fontSize: '12px'
                }}
              />

              {/* Detected provider pill */}
              {detectedProvider && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: detectedProvider.color, background: 'rgba(255,255,255,0.03)', padding: '5px 8px', borderRadius: '4px' }}>
                  <span>✓</span>
                  <span>Detected: <b>{detectedProvider.name}</b></span>
                </div>
              )}

              {/* Currently active providers badges */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px', alignItems: 'center' }}>
                {configuredKeys.nvidia && (
                  <span style={{ fontSize: '10px', background: 'rgba(118, 185, 0, 0.1)', border: '1px solid #76b900', color: '#76b900', padding: '2px 7px', borderRadius: '4px', fontWeight: 500 }}>
                    🟢 NVIDIA NIM Active
                  </span>
                )}
                {configuredKeys.groq && (
                  <span style={{ fontSize: '10px', background: 'rgba(245, 80, 54, 0.1)', border: '1px solid #f55036', color: '#f55036', padding: '2px 7px', borderRadius: '4px', fontWeight: 500 }}>
                    ⚡ Groq Active
                  </span>
                )}
                {configuredKeys.openrouter && (
                  <span style={{ fontSize: '10px', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid #6366f1', color: '#6366f1', padding: '2px 7px', borderRadius: '4px', fontWeight: 500 }}>
                    🌐 OpenRouter Active
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {Object.values(configuredKeys).some(Boolean) ? (
                  <button 
                    onClick={handleClearKeys}
                    style={{ background: 'none', border: 'none', color: 'var(--red-accent)', cursor: 'pointer', fontSize: '10.5px' }}
                  >
                    Clear keys
                  </button>
                ) : <span />}

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {keySaveSuccess && (
                    <span style={{ color: 'var(--green-accent)', fontSize: '11px', fontWeight: 600 }}>✓ Connected!</span>
                  )}
                  <button className="btn-deny" onClick={() => setIsSettingsOpen(false)} style={{ padding: '6px 12px', fontSize: '11px' }}>
                    Close
                  </button>
                  <button 
                    className="btn-approve" 
                    onClick={handleSaveKey}
                    disabled={!singleKeyInput.trim()}
                    style={{ padding: '6px 14px', fontSize: '11px', opacity: singleKeyInput.trim() ? 1 : 0.5 }}
                  >
                    Save & Connect
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

function getFileBadge(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'ts') return <span className="file-badge badge-ts">TS</span>;
  if (ext === 'tsx' || ext === 'jsx') return <span className="file-badge badge-react">⚛</span>;
  if (ext === 'css') return <span className="file-badge badge-css">{"{}"}</span>;
  if (ext === 'json') return <span className="file-badge badge-json">⬡</span>;
  if (ext === 'html') return <span className="file-badge badge-html">&lt;&gt;</span>;
  if (ext === 'py') return <span className="file-badge badge-py">PY</span>;
  return <span className="file-badge badge-file">📄</span>;
}

function parseActivityParts(title: string) {
  if (title.startsWith('Reading ') || title.startsWith('Inspecting directory ')) {
    const target = title.replace('Reading ', '').replace('Inspecting directory ', '');
    const filename = target.split(/[\\/]/).pop() || target;
    return { action: 'Analyzed', filename, isFile: true };
  }
  if (title.startsWith('Writing ') || title.startsWith('Patching ') || title.startsWith('Deleting ')) {
    const target = title.replace('Writing ', '').replace('Patching ', '').replace('Deleting ', '');
    const filename = target.split(/[\\/]/).pop() || target;
    return { action: 'Edited', filename, isFile: true };
  }
  if (title.startsWith('Running `')) {
    const cmd = title.replace('Running `', '').replace(/`$/, '');
    return { action: 'Ran', filename: cmd, isFile: false };
  }
  if (title.startsWith('Checking ')) {
    return { action: 'Checked', filename: 'diagnostics (0ms)', isFile: false };
  }
  return { action: 'Executed', filename: title, isFile: false };
}

const PersistedThoughtBox: React.FC<{ thought: any }> = ({ thought }) => {
  const [open, setOpen] = useState(false);
  if (!thought.content || !thought.content.trim()) return null;
  const dur = thought.durationMs ? `${Math.round(thought.durationMs / 100) / 10}s` : 'a moment';

  return (
    <div className="minimal-thought-container">
      <div className="minimal-thought-row" onClick={() => setOpen(!open)}>
        <span className="thought-label">Thought for {dur}</span>
        <span className="thought-arrow">{open ? '▾' : '›'}</span>
      </div>
      {open && (
        <div className="minimal-thought-drawer">
          {thought.content}
        </div>
      )}
    </div>
  );
};

const ActivityCard: React.FC<{ activity: ActivityItem }> = ({ activity }) => {
  const [expanded, setExpanded] = useState(false);
  const parts = parseActivityParts(activity.title);

  if (activity.status === 'running') {
    return (
      <div className="minimal-activity-row activity-running">
        <span className="pulse-dot" />
        <span className="activity-action">Working on</span>
        <span className="activity-target">{parts.filename}</span>
      </div>
    );
  }

  return (
    <div className="minimal-activity-container">
      <div 
        className="minimal-activity-row" 
        onClick={() => activity.output && setExpanded(!expanded)}
        style={{ cursor: activity.output ? 'pointer' : 'default' }}
      >
        <span className="activity-action">{parts.action}</span>
        {parts.isFile && getFileBadge(parts.filename)}
        <span className="activity-target">{parts.filename}</span>
        {activity.output && <span className="activity-chevron">{expanded ? '▾' : '›'}</span>}
      </div>
      {expanded && activity.output && (
        <div className="minimal-activity-output">
          {activity.output}
        </div>
      )}
    </div>
  );
};

const DiffCard: React.FC<{ diff: DiffItem }> = ({ diff }) => {
  const [expanded, setExpanded] = useState(false);

  // Compute lines changed
  const oldLines = diff.oldContent ? diff.oldContent.split('\n') : [];
  const newLines = diff.newContent ? diff.newContent.split('\n') : [];

  let added = 0;
  let removed = 0;

  if (oldLines.length === 0) {
    added = newLines.length;
  } else {
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    for (const l of newLines) {
      if (!oldSet.has(l)) added++;
    }
    for (const l of oldLines) {
      if (!newSet.has(l)) removed++;
    }
    if (added === 0 && removed === 0 && diff.oldContent !== diff.newContent) {
      added = Math.max(1, Math.abs(newLines.length - oldLines.length));
    }
  }

  return (
    <div className="diff-pill-card">
      <div className="diff-pill-header" onClick={() => setExpanded(!expanded)}>
        <div className="diff-pill-left">
          <span className="diff-pill-filename">{diff.relativeFilePath}</span>
          {added > 0 && <span className="diff-stat-add">+{added}</span>}
          {removed > 0 && <span className="diff-stat-del">-{removed}</span>}
          <span className="diff-pill-arrow">{expanded ? '▾' : '›'}</span>
        </div>
        <button 
          className="diff-review-btn"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          <span>📄</span>
          <span>Review</span>
        </button>
      </div>
      {expanded && (
        <div className="diff-content-drawer">
          <div className="diff-preview-title">Diff Preview:</div>
          <pre className="diff-preview-code">
            {diff.newContent.slice(0, 1200)}
            {diff.newContent.length > 1200 ? '\n... (truncated preview)' : ''}
          </pre>
        </div>
      )}
    </div>
  );
};
