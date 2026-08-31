import { create } from 'zustand';
import { getBuildLlmConfig } from '../lib/analysis';
import { buildLocalAnalysis } from '../lib/localAnalysis';
import { buildSnapshotDigest } from '../lib/live';
import { preprocessTabs } from '../lib/preprocessing';
import {
  loadCurrentSession,
  loadLiveStatus,
  loadPreviousSession,
  loadReflectionFeedback,
  saveLiveStatus,
  saveSession,
  saveSnapshotDigest,
} from '../lib/storage';
import {
  collectCurrentTabs,
  hasTabsPermission,
  isChromeExtension,
  requestAnalysisPermission,
} from '../lib/tabs';
import { createMockTabs } from '../mock/tabs';
import type { AnalysisResult, PreprocessedTabs, Session } from '../types';

type AppStage = 'booting' | 'permission' | 'analyzing' | 'results' | 'error';

interface DashboardState {
  stage: AppStage;
  analysis?: AnalysisResult;
  data?: PreprocessedTabs;
  session?: Session;
  previousSession?: Session;
  error?: string;
  notice?: string;
  revealStep: number;
  initialize: () => Promise<void>;
  runAnalysis: (demo?: boolean) => Promise<void>;
  syncCurrentSession: () => Promise<void>;
  setRevealStep: (step: number) => void;
}

function dataFromSession(session: Session): PreprocessedTabs {
  return preprocessTabs(session.snapshots.map((snapshot) => ({
    title: snapshot.title,
    url: snapshot.sanitizedUrl,
    windowId: snapshot.windowId,
    groupId: snapshot.groupId,
    active: snapshot.active,
    lastAccessed: snapshot.lastAccessed,
  })), session.createdAt);
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  stage: 'booting',
  revealStep: 0,

  initialize: async () => {
    const demoEnvironment = !isChromeExtension() || import.meta.env.VITE_USE_MOCK_ANALYSIS === 'true';
    if (demoEnvironment) {
      await get().runAnalysis(true);
      return;
    }

    const [permission, session, previousSession] = await Promise.all([hasTabsPermission(), loadCurrentSession(), loadPreviousSession()]);
    if (session?.analysis && permission) {
      const restoredData = dataFromSession(session);
      await saveSession(restoredData, session.analysis);
      set({
        stage: 'results',
        session,
        previousSession,
        analysis: session.analysis,
        data: restoredData,
        revealStep: 5,
      });
      return;
    }
    set({ stage: 'permission' });
  },

  runAnalysis: async (demo = false) => {
    set({ stage: 'analyzing', error: undefined, notice: undefined, revealStep: 0 });
    try {
      if (!demo && isChromeExtension()) {
        const granted = await requestAnalysisPermission(getBuildLlmConfig()?.baseUrl);
        if (!granted) {
          set({ stage: 'permission', error: 'Tab access was not granted. Tabscope cannot read titles or URLs without it.' });
          return;
        }
      }

      const rawTabs = demo ? createMockTabs() : await collectCurrentTabs();
      if (rawTabs.length === 0) throw new Error('No readable tabs were found. Open a few normal web pages and try again.');
      const data = preprocessTabs(rawTabs);

      const analysis: AnalysisResult = buildLocalAnalysis(data, demo ? 'mock' : 'local', await loadReflectionFeedback());
      const session = await saveSession(data, analysis);
      const previousSession = await loadPreviousSession();
      const previousStatus = await loadLiveStatus();
      const refreshedAt = Date.now();
      await Promise.all([
        saveSnapshotDigest(buildSnapshotDigest(data)),
        saveLiveStatus({
          state: demo ? 'updated' : 'checking',
          lastCheckedAt: refreshedAt,
          lastUpdatedAt: refreshedAt,
          lastModelAt: previousStatus.lastModelAt,
          lastChangeReason: 'manual-refresh',
        }),
      ]);
      set({
        stage: 'results',
        data,
        analysis,
        session,
        previousSession,
        revealStep: 0,
        notice: demo ? undefined : 'A fast reflection is ready while Tabscope checks for a sharper read.',
      });

      if (!demo && isChromeExtension()) {
        void chrome.runtime.sendMessage({ type: 'RUN_LIVE_REFRESH', data }).catch(async (modelError: unknown) => {
          const status = await loadLiveStatus();
          await saveLiveStatus({
            ...status,
            state: 'error',
            lastCheckedAt: Date.now(),
            lastError: modelError instanceof Error ? modelError.message : 'The background reflection could not start.',
          });
          set({ notice: 'The fast on-device reflection is ready; the sharper model pass could not start.' });
        });
      }
    } catch (error) {
      set({ stage: 'error', error: error instanceof Error ? error.message : 'Something went wrong while analyzing these tabs.' });
    }
  },

  syncCurrentSession: async () => {
    const [session, previousSession] = await Promise.all([loadCurrentSession(), loadPreviousSession()]);
    if (!session?.analysis) return;
    set({
      stage: 'results',
      session,
      previousSession,
      analysis: session.analysis,
      data: dataFromSession(session),
      revealStep: 0,
      notice: undefined,
      error: undefined,
    });
  },

  setRevealStep: (revealStep) => set({ revealStep }),
}));
