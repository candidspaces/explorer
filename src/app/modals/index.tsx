import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonModal,
  IonText,
} from '@ionic/react';
import { PageShell } from '../components/pageShell';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppContext } from '../utils/appContext';
import DirTree, { LeafSelection } from '../components/dirTree';
import MemoFeed, { FeedHandoff } from '../components/memoFeed';
import { indexTransactionsToGraph } from '../utils/indexer';
import { Transaction } from '../utils/appTypes';

const OPEN_LOCATIONS = [
  { name: 'San Francisco', plusCode: '849VQHFJ+X6', lat: 37.7749, lng: -122.4194, notes: 'Open maker meetup and downtown signal checks.' },
  { name: 'New York City', plusCode: '87G8Q257+59', lat: 40.7128, lng: -74.006, notes: 'Open drop-in point near Lower Manhattan.' },
  { name: 'Nairobi', plusCode: '6GCRPR6X+24', lat: -1.2921, lng: 36.8219, notes: 'Community garden and learning exchange location.' },
  { name: 'Tokyo', plusCode: '8Q7XMM4M+P7', lat: 35.6762, lng: 139.6503, notes: 'Late-night collaboration node with reliable coverage.' },
  { name: 'São Paulo', plusCode: '588MHC8Q+X5', lat: -23.5505, lng: -46.6333, notes: 'Open co-working venue for weekend events.' },
  { name: 'Sydney', plusCode: '4RRH46J2+52', lat: -33.8688, lng: 151.2093, notes: 'Harbour-side meetup point and routing check.' },
];

type OpenLocation = (typeof OPEN_LOCATIONS)[number];

const toDisplayPath = (value: string) => {
  const trimmedValue = value.replace(/0+=+$/g, '');
  return trimmedValue || '/';
};

const buildPathSegments = (value: string) => {
  const normalized = toDisplayPath(value);
  if (normalized === '/') {
    return [];
  }

  const parts = normalized.split('/').filter(Boolean);
  let currentPath = '/';

  return parts.map((segment) => {
    currentPath = `${currentPath}${segment}/`;
    return {
      label: segment,
      value: currentPath,
    };
  });
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

  const [mode, setMode] = useState<'map' | 'feed' | 'tree' | 'subfeed'>('map');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [fetchStartHeight, setFetchStartHeight] = useState<number>(0);
  const [canLoadMore, setCanLoadMore] = useState<boolean>(true);
  const [focusHandoff, setFocusHandoff] = useState<FeedHandoff | null>(null);
  const [subFeedContext, setSubFeedContext] = useState<LeafSelection | null>(null);
  const [peekGraphKey, setPeekGraphKey] = useState<string>('/');
  const [selectedLocation, setSelectedLocation] = useState<OpenLocation | null>(null);
  const whichKey = useMemo(() => toDisplayPath(peekGraphKey), [peekGraphKey]);
  const clickableSegments = useMemo(() => buildPathSegments(whichKey), [whichKey]);

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
          {mode === 'map' && (
            <>
              <div style={{ border: '1px solid var(--ion-color-step-200)', borderRadius: 12, overflow: 'hidden', minHeight: 260 }}>
                <iframe
                  title="Open location world map"
                  src="https://www.openstreetmap.org/export/embed.html?bbox=-180%2C-60%2C180%2C80&layer=mapnik"
                  style={{ width: '100%', height: 280, border: 0 }}
                />
              </div>
              <IonText color="medium">Select a location to open details and its plus code.</IonText>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {OPEN_LOCATIONS.map((location) => (
                  <IonCard button key={location.plusCode} onClick={() => setSelectedLocation(location)}>
                    <IonCardHeader>
                      <IonCardSubtitle>{location.plusCode}</IonCardSubtitle>
                      <IonCardTitle>{location.name}</IonCardTitle>
                    </IonCardHeader>
                    <IonCardContent>
                      {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                    </IonCardContent>
                  </IonCard>
                ))}
              </div>
              <IonButton onClick={() => setMode('tree')}>Open Explorer</IonButton>
            </>
          )}

          {mode !== 'map' && !!whichKey && (
            <>
              <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--ion-background-color)', borderBottom: '1px solid var(--ion-color-step-150)', padding: '8px 0', marginBottom: 8 }}>
                <IonButton size="small" fill="clear" onClick={() => setMode('map')}>Back to Map</IonButton>
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

          <IonModal isOpen={!!selectedLocation} onDidDismiss={() => setSelectedLocation(null)}>
            <PageShell
              onDismissModal={() => setSelectedLocation(null)}
              renderBody={() => (
                <div style={{ padding: 16 }}>
                  <h2>{selectedLocation?.name}</h2>
                  <p><strong>Plus code:</strong> {selectedLocation?.plusCode}</p>
                  <p><strong>Coordinates:</strong> {selectedLocation?.lat}, {selectedLocation?.lng}</p>
                  <p>{selectedLocation?.notes}</p>
                </div>
              )}
            />
          </IonModal>
        </div>
      )}
    />
  );
};

export default Explore;
