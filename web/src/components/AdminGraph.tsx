'use client';
// ノードグラフ（@xyflow/react）。親子の付け替え・ツール接続をドラッグで行う。可否の判定は graph-model.canConnect（バックエンドも再検証する）。
import { Background, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow, type Edge, type Node, type NodeChange, type NodeProps, type OnConnect } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildGraph, canConnect, type GraphNode } from '@/lib/graph-model';
import type { Entity, Tool } from '@/lib/types';
import { Avatar } from './IconPicker';

export type Sel = { type: 'node' | 'edge'; id: string } | null;
export interface CtxTarget { clientX: number; clientY: number; x: number; y: number; target: { type: 'node' | 'edge' | 'bg'; id?: string } }

type NodeData = { label: string; sub: string; kind: string; protected: boolean; isTool: boolean; icon: string | null };

function NekoNode({ data, selected }: NodeProps<Node<NodeData>>) {
  return (
    <div className={`gnode ${data.kind}${selected ? ' sel' : ''}${data.protected ? ' protected' : ''}`}>
      <div className="head" />
      {!data.protected && !(data.kind === 'orchestrator') && <Handle type="target" position={Position.Left} className="port" />}
      <div className="title">{!data.isTool && <Avatar icon={data.icon} kind={data.kind} size={18} />}{data.label}</div>
      <div className="subtitle">{data.sub || ' '}</div>
      {!data.isTool && <Handle type="source" position={Position.Right} className="port" />}
    </div>
  );
}
const nodeTypes = { neko: NekoNode };

function Inner({ entities, tools, fitKey, selected, onSelect, onMove, onConnect, onContext }: {
  entities: Entity[]; tools: Tool[]; fitKey: number; selected: Sel; onSelect: (s: Sel) => void;
  onMove: (id: string, x: number, y: number) => void; onConnect: (from: string, to: string) => void; onContext: (c: CtxTarget) => void;
}) {
  const rf = useReactFlow();
  const g = useMemo(() => buildGraph(entities, tools), [entities, tools]);
  const built: Node<NodeData>[] = useMemo(() => g.nodes.map((n: GraphNode) => ({
    id: n.id, type: 'neko', position: { x: n.x, y: n.y }, selected: selected?.type === 'node' && selected.id === n.id,
    data: { label: n.label, sub: n.sub, kind: n.type === 'tool' ? 'tool' : n.kind, protected: n.protected, isTool: n.type === 'tool', icon: n.icon || null },
  })), [g, selected]);
  // ドラッグ中の位置は、ここで持つ（制御コンポーネントは onNodesChange で位置を反映しないと動かない）。台帳が変わったら作り直す
  const [nodes, setNodes] = useState<Node<NodeData>[]>(built);
  useEffect(() => setNodes(built), [built]);
  const onNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => setNodes((ns) => applyNodeChanges(changes, ns)), []);
  const edges: Edge[] = useMemo(() => g.edges.map((e) => ({
    id: e.id, source: e.from, target: e.to, className: `edge ${e.type}`, selected: selected?.type === 'edge' && selected.id === e.id,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }, style: e.type === 'tool' ? { strokeDasharray: '6 4' } : undefined,
  })), [g, selected]);

  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.15, duration: 200 }), 50); return () => clearTimeout(t); }, [fitKey, rf]);

  const isValid = useCallback((c: { source: string; target: string }) => canConnect(entities, tools, c.source, c.target).ok, [entities, tools]);
  const connect: OnConnect = useCallback((c) => { if (c.source && c.target) onConnect(c.source, c.target); }, [onConnect]);
  const ctx = (target: CtxTarget['target']) => (ev: React.MouseEvent | MouseEvent) => {
    ev.preventDefault();
    const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    onContext({ clientX: ev.clientX, clientY: ev.clientY, x: p.x, y: p.y, target });
  };

  return (
    <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} nodeTypes={nodeTypes} minZoom={0.2} maxZoom={2.5} snapToGrid snapGrid={[10, 10]} deleteKeyCode={null}
      nodesConnectable edgesFocusable isValidConnection={isValid} onConnect={connect}
      onNodeDragStop={(_, n) => onMove(n.id, Math.round(n.position.x), Math.round(n.position.y))}
      onNodeClick={(_, n) => onSelect({ type: 'node', id: n.id })} onEdgeClick={(_, e) => onSelect({ type: 'edge', id: e.id })} onPaneClick={() => onSelect(null)}
      onNodeContextMenu={(ev, n) => { onSelect({ type: 'node', id: n.id }); ctx({ type: 'node', id: n.id })(ev); }}
      onEdgeContextMenu={(ev, e) => { onSelect({ type: 'edge', id: e.id }); ctx({ type: 'edge', id: e.id })(ev); }}
      onPaneContextMenu={ctx({ type: 'bg' })} proOptions={{ hideAttribution: true }}>
      <Background gap={24} />
    </ReactFlow>
  );
}

export function AdminGraph(props: React.ComponentProps<typeof Inner>) {
  return <div id="graph"><ReactFlowProvider><Inner {...props} /></ReactFlowProvider></div>;
}
