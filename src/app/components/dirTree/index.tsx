import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonButtons,
  IonHeader,
  IonItem,
  IonList,
  IonModal,
  IonToolbar,
  IonPage,
  IonText,
  IonTitle,
  IonIcon,
} from '@ionic/react';
import { documentTextOutline, linkOutline, logoYoutube } from 'ionicons/icons';
import { GraphLink, GraphNode } from '../../utils/appTypes';
import { getMemoContent, MemoContent } from '../../utils/memoContent';

const MAX_TREE_DEPTH = 8;

interface TreeNode {
  node: GraphNode;
  incoming: GraphLink[];
  outgoing: GraphLink[];
  children: TreeNode[];
}

export interface LeafSelection {
  path: string;
  txId: string;
}

const PLUS_CODE_PATTERN = /^[23456789CFGHJMPQRVWX]{6,8}\+[23456789CFGHJMPQRVWX]{2,3}$/i;

const parsePathSegments = (value?: string) => {
  if (!value || value.includes('\0') || value.includes('//')) {
    return null;
  }

  if (value === '/') {
    return [];
  }

  if (value.startsWith('/')) {
    const pathWithoutRoot = value.slice(1).replace(/\/$/, '');
    if (!pathWithoutRoot) {
      return [];
    }

    return pathWithoutRoot.split('/');
  }

  const normalized = value.replace(/\/$/, '');
  const parts = normalized.split('/');

  if (!PLUS_CODE_PATTERN.test(parts[0])) {
    return null;
  }

  return parts;
};

const isSupportedPath = (value?: string) => parsePathSegments(value) !== null;

const pathLeafName = (value: string) => {
  if (value === '/') {
    return '/';
  }

  const parts = parsePathSegments(value);
  return parts?.at(-1) ?? value;
};

const trimPubkeyDisplay = (value: string) => {
  const trimmedValue = value.replace(/0+=+$/g, '');
  return trimmedValue.length > 0 ? trimmedValue : value;
};

const toDisplayPath = (value: string) => {
  const trimmed = trimPubkeyDisplay(value);
  return trimmed || '/';
};

const getMemoIcon = (memoContent: MemoContent) => {
  if (memoContent.type === 'empty') {
    return null;
  }

  if (memoContent.type === 'youtube') {
    return logoYoutube;
  }

  if (memoContent.type === 'url') {
    return linkOutline;
  }

  return documentTextOutline;
};

const MemoModal = ({
  onDismiss,
  content,
}: {
  onDismiss: () => void;
  content: MemoContent;
}) => {
  const renderMemoContent = () => {
    if (content.type === 'youtube') {
      return (
        <div style={{ position: 'relative', width: '100%', paddingBottom: '177.78%' }}>
          <iframe
            title="Memo YouTube short"
            src={`https://www.youtube.com/embed/${content.videoId}?autoplay=1&playsinline=1`}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              border: 'none',
            }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      );
    }

    if (content.type === 'url') {
      return (
        <iframe
          title="Memo web content"
          src={content.url}
          style={{ width: '100%', height: '75vh', border: 'none', borderRadius: 8 }}
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
        />
      );
    }

    if (content.type === 'empty') {
      return (
        <IonText color="medium">
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{content.text}</p>
        </IonText>
      );
    }

    return (
      <IonText>
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{content.text}</p>
      </IonText>
    );
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton color="medium" onClick={() => onDismiss()}>
              Close
            </IonButton>
          </IonButtons>
          <IonTitle>Memo</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonCard>
          <IonCardContent>{renderMemoContent()}</IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
};

function DirTree({
  forKey,
  setForKey,
  nodes,
  links,
  onLeafOpen,
  onOpenSubFeed,
}: {
  forKey: string;
  setForKey: (pk: string) => void;
  nodes: GraphNode[];
  links: GraphLink[];
  onLeafOpen?: (selection: LeafSelection) => void;
  onOpenSubFeed?: (selection: LeafSelection) => void;
}) {

  const handleNodeFocus = useCallback(
    (node: GraphNode | null | undefined) => {
      if (node?.pubkey) {
        setForKey(toDisplayPath(node.pubkey));
      }
    },
    [setForKey],
  );

  const initialNode = useMemo(() => {
    const displayKey = toDisplayPath(forKey);
    const node = nodes.find((n) => toDisplayPath(n.pubkey) === displayKey);
    return node && isSupportedPath(toDisplayPath(node.pubkey)) ? node : null;
  }, [nodes, forKey]);

  useEffect(() => {
    handleNodeFocus(initialNode);
  }, [initialNode, handleNodeFocus]);

  const [visibleData, setVisibleData] = useState<{
    nodes: GraphNode[];
    links: GraphLink[];
  }>({
    nodes: [],
    links: [],
  });

  const buildTree = useCallback(
    (
      currentNode: GraphNode,
      depth: number,
      path: Set<number>,
      sourceMap: Map<number, GraphLink[]>,
      targetMap: Map<number, GraphLink[]>,
      nodeMap: Map<number, GraphNode>,
    ): TreeNode => {
      const outgoing = sourceMap.get(currentNode.id) ?? [];
      const incoming = targetMap.get(currentNode.id) ?? [];

      if (depth >= MAX_TREE_DEPTH) {
        return {
          node: currentNode,
          outgoing,
          incoming,
          children: [],
        };
      }

      const children = outgoing
        .map((link) => nodeMap.get(link.target))
        .filter((candidate): candidate is GraphNode => {
          return Boolean(candidate && !path.has(candidate.id));
        })
        .map((candidate) => {
          const nextPath = new Set(path);
          nextPath.add(candidate.id);
          return buildTree(
            candidate,
            depth + 1,
            nextPath,
            sourceMap,
            targetMap,
            nodeMap,
          );
        });

      return {
        node: currentNode,
        outgoing,
        incoming,
        children,
      };
    },
    [],
  );

  const rootTree = useMemo(() => {
    if (!initialNode) {
      return null;
    }

    const sourceMap = new Map<number, GraphLink[]>();
    const targetMap = new Map<number, GraphLink[]>();
    const nodeMap = new Map<number, GraphNode>(nodes.map((node) => [node.id, node]));

    for (const link of visibleData.links) {
      sourceMap.set(link.source, [...(sourceMap.get(link.source) ?? []), link]);
      targetMap.set(link.target, [...(targetMap.get(link.target) ?? []), link]);
    }

    return buildTree(
      initialNode,
      0,
      new Set<number>([initialNode.id]),
      sourceMap,
      targetMap,
      nodeMap,
    );
  }, [buildTree, initialNode, nodes, visibleData.links]);

  useEffect(() => {
    if (!initialNode) {
      setVisibleData({ nodes: [], links: [] });
      return;
    }

    const applicableLinks = links.filter((link) => {
      const targetNode = nodes.find((candidate) => candidate.id === link.target);
      return isSupportedPath(toDisplayPath(targetNode?.pubkey ?? ""));
    });

    const applicableNodeIds = new Set<number>([
      initialNode.id,
      ...applicableLinks.map((link) => link.source),
      ...applicableLinks.map((link) => link.target),
    ]);

    const applicableNodes = nodes.filter((node) => applicableNodeIds.has(node.id));

    setVisibleData({
      nodes: applicableNodes,
      links: applicableLinks,
    });
  }, [initialNode, links, nodes]);

  return (
    <IonCard>
      <IonCardContent>
        {!rootTree && <p>No entries available for this key.</p>}
        {rootTree && (
          <TreeBranch
            branch={rootTree}
            isRoot={true}
            onNodeClick={(node) => handleNodeFocus(node)}
            currentKey={forKey}
            onLeafOpen={onLeafOpen}
            onOpenSubFeed={onOpenSubFeed}
          />
        )}
      </IonCardContent>
    </IonCard>
  );
}

const TreeBranch = ({
  branch,
  onNodeClick,
  currentKey,
  isRoot = false,
  depth = 0,
  maxVisibleDepth = 1,
  onLeafOpen,
  onOpenSubFeed,
}: {
  branch: TreeNode;
  onNodeClick: (node: GraphNode) => void;
  currentKey: string;
  isRoot?: boolean;
  depth?: number;
  maxVisibleDepth?: number;
  onLeafOpen?: (selection: LeafSelection) => void;
  onOpenSubFeed?: (selection: LeafSelection) => void;
}) => {

  const trimmedPubkey = toDisplayPath(branch.node.pubkey);
  const isCurrentNode = toDisplayPath(branch.node.pubkey) === toDisplayPath(currentKey);
  const [activeMemo, setActiveMemo] = useState<MemoContent | null>(null);
  const memoContent = getMemoContent(branch.node.memo);
  const memoIcon = getMemoIcon(memoContent);
  const isCurrentNodeWithoutMemo = isCurrentNode && memoContent.type === 'empty';
  const isNodeButtonEnabled = !isCurrentNodeWithoutMemo;

  return (
    <div
      style={{
        borderLeft: isRoot ? 'none' : '1px solid var(--ion-color-medium)',
        marginLeft: isRoot ? 0 : 8,
        paddingLeft: isRoot ? 0 : 12,
        marginBottom: 8,
      }}
    >
      <IonList inset={true}>
        <IonItem
          button={isNodeButtonEnabled}
          detail={true}
          disabled={!isNodeButtonEnabled}
          color={isCurrentNode ? 'primary' : undefined}
          onClick={() => {
            if (!isNodeButtonEnabled) {
              return;
            }
            if (isCurrentNode && memoContent) {
              if (branch.node.memoTransactionId) {
                const selection = {
                  path: trimmedPubkey,
                  txId: branch.node.memoTransactionId,
                };
                if (onOpenSubFeed) {
                  onOpenSubFeed(selection);
                  return;
                }
                if (onLeafOpen) {
                  onLeafOpen(selection);
                  return;
                }
              }
              setActiveMemo(memoContent);
              return;
            }
            onNodeClick(branch.node);
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              overflow: 'hidden',
            }}
          >
            <code style={{ opacity: 0.75 }}>{pathLeafName(trimmedPubkey)}</code>
          </div>
          {isCurrentNode && memoIcon && (
            <IonIcon
              slot="end"
              icon={memoIcon}
              aria-label={`Memo ${memoContent?.type ?? 'content'} icon`}
            />
          )}
        </IonItem>
      </IonList>

      {branch.children.length > 0 && depth < maxVisibleDepth && (
        <div style={{ marginTop: 4 }}>
          {branch.children.map((child) => (
            <TreeBranch
              key={`${branch.node.id}-${child.node.id}`}
              branch={child}
              onNodeClick={onNodeClick}
              currentKey={currentKey}
              depth={depth + 1}
              maxVisibleDepth={maxVisibleDepth}
              onLeafOpen={onLeafOpen}
              onOpenSubFeed={onOpenSubFeed}
            />
          ))}
        </div>
      )}

      <IonModal isOpen={Boolean(activeMemo)} onDidDismiss={() => setActiveMemo(null)}>
        {activeMemo && (
          <MemoModal
            onDismiss={() => setActiveMemo(null)}
            content={activeMemo}
          />
        )}
      </IonModal>
    </div>
  );
};

export default DirTree;
