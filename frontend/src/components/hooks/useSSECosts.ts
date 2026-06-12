import { useState, useCallback, useRef, useEffect } from 'react';
import type { CostItem } from '../types';

interface SSEMessage {
  type: 'batch' | 'data' | 'status' | 'done' | 'error';
  subID?: string;
  data?: {
    subscriptions?: Record<string, CostData>;
    count?: number;
    current?: CostItem[];
    previous?: CostItem[];
  };
  Message?: string;
}

interface CostData {
  current?: CostItem[];
  previous?: CostItem[];
}

interface UseSSECostsOptions {
  baseUrl?: string;
  onBatchReceived?: (data: Record<string, CostData>) => void;
  onSubscriptionSynced?: (subID: string) => void;
}

interface SSEState {
  connected: boolean;
  syncing: boolean;
  completed: boolean;
  progress: {
    total: number;
    synced: number;
    errors: number;
  };
}

export function useSSECosts(options: UseSSECostsOptions = {}) {
  const { baseUrl = '', onBatchReceived, onSubscriptionSynced } = options;

  const [costsBySubscription, setCostsBySubscription] = useState<Record<string, CostData>>({});
  const [sseState, setSSEState] = useState<SSEState>({
    connected: false,
    syncing: false,
    completed: false,
    progress: { total: 0, synced: 0, errors: 0 }
  });
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const connectRef = useRef<(subscriptionIds: string[]) => void>(() => {});
  const subscriptionIdsRef = useRef<string[]>([]);

  // Close SSE connection
  const closeConnection = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setSSEState(prev => ({ ...prev, connected: false, syncing: false }));
  }, []);

  // Connect to SSE endpoint
  const connect = useCallback((subscriptionIds: string[]) => {
    // Update ref to avoid stale closure in auto-reconnect
    subscriptionIdsRef.current = subscriptionIds;

    // Close existing connection
    closeConnection();

    if (subscriptionIds.length === 0) return;

    setError(null);
    setSSEState({
      connected: false,
      syncing: true,
      completed: false,
      progress: { total: subscriptionIds.length, synced: 0, errors: 0 }
    });

    const params = new URLSearchParams();
    subscriptionIds.forEach(id => params.append('subscriptionId', id));

    const url = `${baseUrl}/api/costs/stream?${params.toString()}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setSSEState(prev => ({ ...prev, connected: true }));
    };

    eventSource.onmessage = (event) => {
      try {
        const msg: SSEMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'batch':
            // Handle batch update with multiple subscriptions
            if (msg.data?.subscriptions) {
              setCostsBySubscription(prev => ({
                ...prev,
                ...msg.data!.subscriptions
              }));
              onBatchReceived?.(msg.data.subscriptions);

              // Update progress
              const syncedCount = Object.keys(msg.data.subscriptions).length;
              setSSEState(prev => ({
                ...prev,
                progress: {
                  ...prev.progress,
                  synced: prev.progress.synced + syncedCount
                }
              }));
            }
            break;

          case 'data':
            // Handle individual subscription update
            if (msg.subID && msg.data) {
              setCostsBySubscription(prev => ({
                ...prev,
                [msg.subID!]: {
                  current: msg.data?.current || prev[msg.subID!]?.current,
                  previous: msg.data?.previous || prev[msg.subID!]?.previous
                }
              }));
            }
            break;

          case 'status':
            if (msg.subID) {
              if (msg.Message === 'synced') {
                setSSEState(prev => ({
                  ...prev,
                  progress: {
                    ...prev.progress,
                    synced: prev.progress.synced + 1
                  }
                }));
                onSubscriptionSynced?.(msg.subID);
              } else if (msg.Message?.startsWith('error:')) {
                setSSEState(prev => ({
                  ...prev,
                  progress: {
                    ...prev.progress,
                    errors: prev.progress.errors + 1
                  }
                }));
              }
            }
            break;

          case 'done':
            setSSEState(prev => ({
              ...prev,
              syncing: false,
              completed: true
            }));
            eventSource.close();
            eventSourceRef.current = null;
            break;

          case 'error':
            setError(msg.Message || 'Unknown SSE error');
            setSSEState(prev => ({
              ...prev,
              syncing: false,
              progress: {
                ...prev.progress,
                errors: prev.progress.errors + 1
              }
            }));
            break;
        }
      } catch (err) {
        console.error('Error parsing SSE message:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE error:', err);
      setError('SSE connection error');
      setSSEState(prev => ({ ...prev, connected: false, syncing: false }));
      eventSource.close();
      eventSourceRef.current = null;

      // Auto-reconnect after 5 seconds if not completed
      if (!sseState.completed) {
        reconnectTimerRef.current = setTimeout(() => {
          connectRef.current(subscriptionIdsRef.current);
        }, 5000);
      }
    };
  }, [baseUrl, closeConnection, onBatchReceived, onSubscriptionSynced, sseState.completed]);

  // Keep connect ref updated to avoid accessing connect before declaration / TDZ
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      closeConnection();
    };
  }, [closeConnection]);

  // Get all costs as flat array
  const allCosts = Object.values(costsBySubscription).flatMap(sub =>
    [...(sub.current || []), ...(sub.previous || [])]
  );

  // Get total cost
  const totalCost = allCosts.reduce((sum, item) => sum + (item.cost || 0), 0);

  // Get unique subscriptions count
  const subscriptionCount = Object.keys(costsBySubscription).length;

  return {
    costsBySubscription,
    allCosts,
    totalCost,
    subscriptionCount,
    sseState,
    error,
    connect,
    closeConnection,
    isConnected: sseState.connected,
    isSyncing: sseState.syncing,
    isCompleted: sseState.completed
  };
}
