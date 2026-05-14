import {
  IonButton,
  IonText,
} from '@ionic/react';
import { PageShell } from '../components/pageShell';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppContext } from '../utils/appContext';
import DirTree, { LeafSelection } from '../components/dirTree';
import MemoFeed, { FeedHandoff } from '../components/memoFeed';
import { indexTransactionsToGraph } from '../utils/indexer';
import { Transaction } from '../utils/appTypes';
import { OpenLocationCode } from 'open-location-code';

const OLC = new OpenLocationCode();
const PLUS_CODE_PATTERN = /^[23456789CFGHJMPQRVWX]{6,8}\+[23456789CFGHJMPQRVWX]{2,3}$/i;

const toDisplayPath = (value: string) => {
  const trimmedValue = value.replace(/0+=+$/g, '');
  return trimmedValue || '/';
};

const hasRepeatedSlashes = (value: string) => /\/{2,}/.test(value);

const getPathSegments = (value: string) => {
  if (value === '/' || hasRepeatedSlashes(value)) {
    return null;
  }

  const isAbsolute = value.startsWith('/');
  const trimmed = value.replace(/\/$/, '');
  const parts = (isAbsolute ? trimmed.slice(1) : trimmed).split('/').filter(Boolean);

  return { isAbsolute, parts };
};

const buildPathSegments = (value: string) => {
  const normalized = toDisplayPath(value);
  const parsed = getPathSegments(normalized);
  if (!parsed) {
    return [];
  }

  const { isAbsolute, parts } = parsed;
  let currentPath = isAbsolute ? '/' : '';

  return parts.map((segment, index) => {
    if (isAbsolute) {
      currentPath = `${currentPath}${segment}/`;
    } else {
      currentPath = index === 0 ? segment : `${currentPath}/${segment}`;
    }

    return {
      label: segment,
      value: currentPath,
    };
  });
};

const MapOverview = ({ plusCodes }: { plusCodes: string[] }) => {
  const markers = useMemo(() => plusCodes.flatMap((plusCode) => {
    try {
      const decoded = OLC.decode(plusCode.toUpperCase());
      return [{
        plusCode,
        lat: decoded.latitudeCenter,
        lng: decoded.longitudeCenter,
      }];
    } catch {
      return [];
    }
  }), [plusCodes]);

  return (
    <div style={{ border: '1px solid var(--ion-color-step-200)', borderRadius: 12, overflow: 'hidden', background: 'linear-gradient(180deg, #dff4ff 0%, #edf7e9 100%)' }}>
      <div style={{ width: '100%', height: 240, position: 'relative' }}>
        {markers.map((marker) => {
          const left = ((marker.lng + 180) / 360) * 100;
          const top = ((90 - marker.lat) / 180) * 100;
          return (
            <div key={marker.plusCode} style={{ position: 'absolute', left: `${left}%`, top: `${top}%`, transform: 'translate(-50%, -50%)', width: 12, height: 12, borderRadius: '50%', background: 'var(--ion-color-danger)', border: '2px solid white' }} title={marker.plusCode} />
          );
        })}
      </div>
      <div style={{ padding: 8 }}>
        <IonText color="medium">
          {markers.length > 0
            ? `${markers.length} plus-code root segment${markers.length === 1 ? '' : 's'} mapped from tree roots.`
            : 'No plus-code root segments found in the current tree.'}
        </IonText>
      </div>
    </div>
  );
};

const Explore = () => {
  const {
    graph,
    setGraph,
    tipHeader,
    navigatorPublicKey,
    setNavigatorPublicKey,
    transactionRange,
    requestPkTransactions,
  } =
    useContext(AppContext);

  const [mode, setMode] = useState<'feed' | 'tree' | 'subfeed'>('tree');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [fetchStartHeight, setFetchStartHeight] = useState<number>(0);
  const [canLoadMore, setCanLoadMore] = useState<boolean>(true);
  const [focusHandoff, setFocusHandoff] = useState<FeedHandoff | null>(null);
  const [subFeedContext, setSubFeedContext] = useState<LeafSelection | null>(null);
  const [peekGraphKey, setPeekGraphKey] = useState<string>('/');
  const whichKey = useMemo(() => toDisplayPath(peekGraphKey), [peekGraphKey]);
  const clickableSegments = useMemo(() => buildPathSegments(whichKey), [whichKey]);
  const rootPlusCodes = useMemo(() => {
    if (!graph?.nodes?.length) {
      return [];
    }

    const uniqueCodes = new Set<string>();
    graph.nodes.forEach((node) => {
      const parsed = getPathSegments(toDisplayPath(node.pubkey));
      const firstSegment = parsed?.parts[0];
      if (firstSegment && PLUS_CODE_PATTERN.test(firstSegment)) {
        uniqueCodes.add(firstSegment.toUpperCase());
      }
    });
    return [...uniqueCodes].sort();
  }, [graph?.nodes]);

  const fetchTransactions = useCallback((
    startHeight: number,
    endHeight: number,
    replace: boolean,
  ) => {
    if (!navigatorPublicKey) {
      return;
    }

    requestPkTransactions(
      navigatorPublicKey,
      (nextTransactions) => {
        setTransactions((previous) =>
          replace ? nextTransactions : [...previous, ...nextTransactions],
        );
        setCanLoadMore(nextTransactions.length >= transactionRange.limit);
      },
      {
        startHeight,
        endHeight,
        limit: transactionRange.limit,
      },
    );
  }, [navigatorPublicKey, requestPkTransactions, transactionRange.limit]);

  useEffect(() => {
    let cleanup = () => {};
    const timeoutId = window.setTimeout(() => {
      if (!navigatorPublicKey) {
        setGraph(null);
        setTransactions([]);
        setCanLoadMore(false);
        return;
      }

      const latestStartHeight = tipHeader?.header.height
        ? tipHeader.header.height + 1
        : transactionRange.startHeight;
      setFetchStartHeight(latestStartHeight);
      cleanup =
        requestPkTransactions(
          navigatorPublicKey,
          (transactions) => {
            setTransactions(transactions);
            setCanLoadMore(transactions.length >= transactionRange.limit);
          },
          {
            startHeight: latestStartHeight,
            endHeight: 0,
            limit: transactionRange.limit,
          },
        ) ?? cleanup;
    }, 0);

    return () => {
      cleanup();
      window.clearTimeout(timeoutId);
    };
  }, [
    navigatorPublicKey,
    requestPkTransactions,
    setGraph,
    tipHeader?.header.height,
    transactionRange.endHeight,
    transactionRange.limit,
    transactionRange.startHeight,
  ]);

  useEffect(() => {
    const resultHandler = (data: any) => {
      if (whichKey && data.detail) {
        if (!navigatorPublicKey) {
          return;
        }
        requestPkTransactions(
          navigatorPublicKey,
          (transactions) => {
            setTransactions(transactions);
            setCanLoadMore(transactions.length >= transactionRange.limit);
          },
          {
            startHeight: tipHeader?.header.height ? tipHeader.header.height + 1 : transactionRange.startHeight,
            endHeight: 0,
            limit: transactionRange.limit,
          },
        );
      }
    };

    document.addEventListener('inv_block', resultHandler);

    return () => {
      document.removeEventListener('inv_block', resultHandler);
    };
  }, [
    navigatorPublicKey,
    requestPkTransactions,
    tipHeader?.header.height,
    transactionRange.endHeight,
    transactionRange.limit,
    transactionRange.startHeight,
    whichKey,
  ]);

  useEffect(() => {
    if (!navigatorPublicKey) {
      setGraph(null);
      return;
    }

    setGraph(indexTransactionsToGraph(transactions, navigatorPublicKey));
  }, [navigatorPublicKey, setGraph, transactions]);

  const loadMore = useCallback(() => {
    if (!canLoadMore) {
      return;
    }

    const nextEndHeight = fetchStartHeight - 1;
    const nextStartHeight = Math.max(1, nextEndHeight - transactionRange.limit + 1);
    setFetchStartHeight(nextStartHeight);
    fetchTransactions(nextStartHeight, nextEndHeight, false);
  }, [canLoadMore, fetchStartHeight, fetchTransactions, transactionRange.limit]);

  return (
    <PageShell
      tools={[]}
      renderBody={() => (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, padding: 12, gap: 12 }}>
          <div style={{ position: 'sticky', top: 0, zIndex: 25, background: 'var(--ion-background-color)', paddingBottom: 8 }}>
            <MapOverview plusCodes={rootPlusCodes} />
          </div>
          {!!whichKey && (
            <>
              <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--ion-background-color)', borderBottom: '1px solid var(--ion-color-step-150)', padding: '8px 0', marginBottom: 8 }}>
                <div style={{ fontFamily: 'monospace, monospace', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => { setPeekGraphKey('/'); setSubFeedContext(null); if (mode !== 'tree') { setMode('tree'); } }} style={{ border: 'none', background: 'transparent', color: 'var(--ion-color-primary)', textDecoration: 'underline' }}>..</button>
                  <code>/</code>
                  {clickableSegments.map((segment, index) => (
                    <div key={segment.value} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button type="button" onClick={() => { setPeekGraphKey(segment.value); setSubFeedContext(null); if (mode !== 'tree') { setMode('tree'); } }} style={{ border: 'none', background: 'transparent', color: 'var(--ion-color-primary)', textDecoration: 'underline' }}>{segment.label}</button>
                      {index < clickableSegments.length - 1 && <code>/</code>}
                    </div>
                  ))}
                </div>
              </div>
              {!!graph && <div style={{ flex: 1, minHeight: 0 }}>{mode === 'tree' && <DirTree forKey={whichKey} nodes={graph.nodes ?? []} links={graph.links ?? []} setForKey={setPeekGraphKey} onLeafOpen={(selection) => { setMode('feed'); setFocusHandoff({ txId: selection.txId, path: selection.path, source: 'tree-leaf' }); setPeekGraphKey(selection.path); setSubFeedContext(null); }} onOpenSubFeed={(selection) => { setSubFeedContext(selection); setMode('subfeed'); setPeekGraphKey(selection.path); }} />}
              {mode === 'subfeed' && subFeedContext && <MemoFeed transactions={transactions} onLoadMore={loadMore} canLoadMore={canLoadMore} focusHandoff={{ txId: subFeedContext.txId, path: subFeedContext.path, source: 'tree-leaf' }} filterPath={subFeedContext.path} onBackToMainFeed={(handoff) => { setMode('feed'); setPeekGraphKey(handoff.path); setFocusHandoff(handoff); setSubFeedContext(null); }} onSwitchNavigator={(nextKey) => { setNavigatorPublicKey(nextKey); setPeekGraphKey('/'); setMode('feed'); setSubFeedContext(null); }} onActivePathChange={(path) => { if (mode === 'subfeed') { setPeekGraphKey(path ?? subFeedContext.path); } }} />}
              {mode === 'feed' && <MemoFeed transactions={transactions} onLoadMore={loadMore} canLoadMore={canLoadMore} focusHandoff={focusHandoff} onFocusConsumed={() => setFocusHandoff(null)} onSwitchNavigator={(nextKey) => { setNavigatorPublicKey(nextKey); setPeekGraphKey('/'); setMode('feed'); setSubFeedContext(null); }} onActivePathChange={(path) => { if (mode === 'feed') { setPeekGraphKey(path ?? '/'); } }} />}</div>}
            </>
          )}

        </div>
      )}
    />
  );
};

export default Explore;
