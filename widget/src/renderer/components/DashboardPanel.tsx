import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ConversationStore, QuizProgress, StoredConversation, Settings } from '../../shared/types';
import '../styles/dashboard-panel.css';
import CapabilityReport from './CapabilityReport';

interface DashboardPanelProps {
  onModeChange: (mode: string) => void;
  onNewConversation: () => void;
}

interface DashboardData {
  totalConversations: number;
  totalMessages: number;
  quizStreak: number;
  quizBestStreak: number;
  topicScores: Record<string, { correct: number; total: number }>;
  recentConversations: { id: string; title: string; updatedAt: string }[];
  activeModel: string;
  ollamaStatus: 'online' | 'offline' | 'checking';
  ollamaModelsCount: number;
  crm: CrmDashboard | null;
}

/** Read-only CRM numbers from homebot:get-crm-dashboard. null = unavailable. */
interface CrmDashboard {
  openDealCount: number;
  pipelineValueFormatted: string;
  staleDealCount: number;
  tasksDueTodayCount: number;
  tasksOverdueCount: number;
  isEmpty: boolean;
}

const DEFAULT_DATA: DashboardData = {
  totalConversations: 0,
  totalMessages: 0,
  quizStreak: 0,
  quizBestStreak: 0,
  topicScores: {},
  recentConversations: [],
  activeModel: 'Unknown',
  ollamaStatus: 'checking',
  ollamaModelsCount: 0,
  crm: null,
};

function formatRelativeDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

const DashboardPanel: React.FC<DashboardPanelProps> = ({ onModeChange, onNewConversation }) => {
  const [data, setData] = useState<DashboardData>(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const electron = window.electron;
      if (!electron) {
        throw new Error('Electron API not available');
      }

      // Fire all requests in parallel
      const [conversationsResult, quizResult, ollamaResult, settingsResult, analyticsResult, crmResult] =
        await Promise.allSettled([
          electron.loadConversations?.(),
          electron.loadQuizProgress?.(),
          electron.listOllamaModels?.(),
          electron.getSettings(),
          electron.getAnalyticsSummary?.(),
          electron.getCrmDashboard?.(),
        ]);

      if (!mounted.current) return;

      // Parse conversations
      let totalConversations = 0;
      let totalMessages = 0;
      let recentConversations: DashboardData['recentConversations'] = [];

      if (conversationsResult.status === 'fulfilled' && conversationsResult.value?.success) {
        const store = conversationsResult.value.data as ConversationStore | undefined;
        const convos = store?.conversations ?? [];
        totalConversations = convos.length;
        totalMessages = convos.reduce(
          (sum: number, c: StoredConversation) => sum + (c.messages?.length ?? 0),
          0
        );
        // Sort by updatedAt descending, take last 5
        const sorted = [...convos].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        recentConversations = sorted.slice(0, 5).map((c) => ({
          id: c.id,
          title: c.title || 'Untitled',
          updatedAt: c.updatedAt,
        }));
      }

      // Parse quiz progress
      let quizStreak = 0;
      let quizBestStreak = 0;
      let topicScores: Record<string, { correct: number; total: number }> = {};

      if (quizResult.status === 'fulfilled' && quizResult.value?.success && quizResult.value.data) {
        const progress = quizResult.value.data as QuizProgress;
        quizStreak = progress.streak ?? 0;
        quizBestStreak = progress.bestStreak ?? 0;
        topicScores = progress.topicScores ?? {};
      }

      // Parse Ollama models
      let ollamaStatus: 'online' | 'offline' = 'offline';
      let ollamaModelsCount = 0;

      if (ollamaResult.status === 'fulfilled' && ollamaResult.value?.success) {
        ollamaStatus = 'online';
        ollamaModelsCount = ollamaResult.value.models?.length ?? 0;
      }

      // Parse settings for active model
      let activeModel = 'Unknown';

      if (settingsResult.status === 'fulfilled') {
        const settings = settingsResult.value as Settings;
        activeModel = settings.chatModel || settings.customLLM?.model || 'Default';
      }

      // Override with analytics summary if available (may have richer counts)
      if (analyticsResult.status === 'fulfilled' && analyticsResult.value?.success && analyticsResult.value.summary) {
        const summary = analyticsResult.value.summary;
        if (typeof summary.totalConversations === 'number') {
          totalConversations = summary.totalConversations;
        }
        if (typeof summary.totalMessages === 'number') {
          totalMessages = summary.totalMessages;
        }
      }

      // Parse CRM summary — degrade to null (section hidden) on any failure
      let crm: CrmDashboard | null = null;
      if (crmResult.status === 'fulfilled' && crmResult.value?.success && crmResult.value.summary) {
        crm = crmResult.value.summary as CrmDashboard;
      }

      setData({
        totalConversations,
        totalMessages,
        quizStreak,
        quizBestStreak,
        topicScores,
        recentConversations,
        activeModel,
        ollamaStatus,
        ollamaModelsCount,
        crm,
      });
    } catch (err: any) {
      if (mounted.current) {
        setError(err?.message || 'Failed to load dashboard data');
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    fetchData();
    return () => {
      mounted.current = false;
    };
  }, [fetchData]);

  // Loading state
  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="dashboard-spinner" />
          <p className="dashboard-loading-text">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-error">
          <p className="dashboard-error-text">{error}</p>
          <button className="dashboard-retry-btn" onClick={fetchData}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const topicEntries = Object.entries(data.topicScores);

  return (
    <div className="dashboard-container">
      {/* Header */}
      <div className="dashboard-header">
        <h1 className="dashboard-title">Welcome Back</h1>
        <p className="dashboard-subtitle">Your HomeBot assistant at a glance</p>
      </div>

      {/* Model Status */}
      <div className="dashboard-model-status">
        <div className="dashboard-model-info">
          <span className="dashboard-model-label">Active Model</span>
          <span className="dashboard-model-name">{data.activeModel}</span>
          {data.ollamaModelsCount > 0 && (
            <span className="dashboard-models-count">
              {data.ollamaModelsCount} model{data.ollamaModelsCount !== 1 ? 's' : ''} installed
            </span>
          )}
        </div>
        <span className={`dashboard-ollama-badge ${data.ollamaStatus}`}>
          <span className="dashboard-ollama-dot" />
          Ollama {data.ollamaStatus === 'online' ? 'Online' : data.ollamaStatus === 'checking' ? 'Checking...' : 'Offline'}
        </span>
      </div>

      {/* Stat Cards */}
      <div className="dashboard-stats-grid">
        <div className="dashboard-stat-card">
          <span className="dashboard-stat-value">{data.totalConversations}</span>
          <span className="dashboard-stat-label">Conversations</span>
        </div>
        <div className="dashboard-stat-card">
          <span className="dashboard-stat-value">{data.totalMessages}</span>
          <span className="dashboard-stat-label">Messages</span>
        </div>
        <div className="dashboard-stat-card">
          <span className="dashboard-stat-value">{data.quizStreak}</span>
          <span className="dashboard-stat-label">Quiz Streak</span>
        </div>
        <div className="dashboard-stat-card">
          <span className="dashboard-stat-value">{data.quizBestStreak}</span>
          <span className="dashboard-stat-label">Best Streak</span>
        </div>
      </div>

      {/* CRM at a glance */}
      {data.crm && (
        <div data-testid="dashboard-crm-section">
          <h2 className="dashboard-section-title">CRM</h2>
          {data.crm.isEmpty ? (
            <div className="dashboard-crm-empty">
              No CRM data yet — ask HomeBot to add a company or a deal and it will show up here.
            </div>
          ) : (
            <div className="dashboard-stats-grid dashboard-crm-grid">
              <div className="dashboard-stat-card">
                <span className="dashboard-stat-value">{data.crm.pipelineValueFormatted}</span>
                <span className="dashboard-stat-label">
                  Open Pipeline ({data.crm.openDealCount} deal{data.crm.openDealCount !== 1 ? 's' : ''})
                </span>
              </div>
              <div className={`dashboard-stat-card ${data.crm.staleDealCount > 0 ? 'dashboard-stat-warn' : ''}`}>
                <span className="dashboard-stat-value">{data.crm.staleDealCount}</span>
                <span className="dashboard-stat-label">Stale Deals</span>
              </div>
              <div className={`dashboard-stat-card ${data.crm.tasksOverdueCount > 0 ? 'dashboard-stat-warn' : ''}`}>
                <span className="dashboard-stat-value">
                  {data.crm.tasksDueTodayCount}
                  {data.crm.tasksOverdueCount > 0 ? ` (+${data.crm.tasksOverdueCount} overdue)` : ''}
                </span>
                <span className="dashboard-stat-label">Tasks Due Today</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* What's working — above Quick Actions on purpose. Offering someone a
          "Make a video" button while ffmpeg is missing, or "Search the web"
          while no search source is set up, is how the app came to fail quietly
          in the first place. */}
      <CapabilityReport />

      {/* Quick Actions */}
      <div>
        <h2 className="dashboard-section-title">Quick Actions</h2>
        <div className="dashboard-actions-row">
          <button
            className="dashboard-action-btn"
            onClick={() => {
              onModeChange('chat');
              onNewConversation();
            }}
          >
            <span className="dashboard-action-icon">💬</span>
            <span className="dashboard-action-label">New Chat</span>
          </button>
          <button
            className="dashboard-action-btn"
            onClick={() => onModeChange('quiz')}
          >
            <span className="dashboard-action-icon">🧠</span>
            <span className="dashboard-action-label">Start Quiz</span>
          </button>
          <button
            className="dashboard-action-btn"
            onClick={() => onModeChange('image')}
          >
            <span className="dashboard-action-icon">🎨</span>
            <span className="dashboard-action-label">Generate Image</span>
          </button>
          <button
            className="dashboard-action-btn"
            onClick={() => onModeChange('automation')}
          >
            <span className="dashboard-action-icon">⚡</span>
            <span className="dashboard-action-label">Automations</span>
          </button>
        </div>
      </div>

      {/* Recent Conversations */}
      <div className="dashboard-recent-section">
        <h2 className="dashboard-section-title">Recent Conversations</h2>
        {data.recentConversations.length > 0 ? (
          <div className="dashboard-recent-list">
            {data.recentConversations.map((conv) => (
              <div key={conv.id} className="dashboard-recent-item">
                <span className="dashboard-recent-icon">💬</span>
                <span className="dashboard-recent-title">{conv.title}</span>
                <span className="dashboard-recent-date">
                  {formatRelativeDate(conv.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="dashboard-recent-empty">
            No conversations yet. Start chatting to see them here.
          </div>
        )}
      </div>

      {/* Topic Scores Breakdown */}
      <div className="dashboard-topics-section">
        <h2 className="dashboard-section-title">Quiz Topic Scores</h2>
        {topicEntries.length > 0 ? (
          <div className="dashboard-topic-list">
            {topicEntries.map(([topic, scores]) => {
              const pct = scores.total > 0 ? Math.round((scores.correct / scores.total) * 100) : 0;
              return (
                <div key={topic} className="dashboard-topic-row">
                  <span className="dashboard-topic-name">{topic}</span>
                  <div className="dashboard-topic-bar-track">
                    <div
                      className="dashboard-topic-bar-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="dashboard-topic-score">
                    {scores.correct}/{scores.total} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="dashboard-topics-empty">
            No quiz scores yet. Take a quiz to track your progress.
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPanel;
