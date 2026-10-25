'use client';
// ノードグラフ（@xyflow/react）。親子の付け替え・ツール接続をドラッグで行う。可否の判定は graph-model.canConnect（バックエンドも再検証する）。
import { Background, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow, type Edge, type Node, type NodeChange, type NodeProps, type OnConnect } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CALL_IN, CALL_OUT, buildGraph, canConnect, type GraphNode } from '@/lib/graph-model';
import type { Entity, Tool } from '@/lib/types';
import { Icon } from './Icon';
import { Avatar } from './IconPicker';

export type Sel = { type: 'node' | 'edge'; id: string } | null;
export interface CtxTarget { clientX: number; clientY: number; x: number; y: number; target: { type: 'node' | 'edge' | 'bg'; id?: string } }

type NodeData = { label: string; sub: string; kind: string; protected: boolean; isTool: boolean; isDir: boolean; isLlm: boolean; isPy: boolean; isInput: boolean; icon: string | null };

function NekoNode({ data, selected }: NodeProps<Node<NodeData>>) {
  return (
    <div className={`gnode ${data.kind}${data.isDir ? ' dir' : ''}${data.isLlm ? ' llm' : ''}${data.isPy ? ' py' : ''}${data.isInput ? ' input' : ''}${selected ? ' sel' : ''}${data.protected ? ' protected' : ''}`}>
      <div className="head" />
      {!data.protected && !(data.kind === 'orchestrator') && <Handle type="target" position={Position.Left} className="port" />}
      {!data.isTool && data.kind !== 'orchestrator' && <Handle id={CALL_IN} type="target" position={Position.Top} className="port call" title="呼ばれる側（呼ぶ担当のワイヤーをつなぐ）" />}
      <div className="title">{!data.isTool && <Avatar icon={data.icon} kind={data.kind} size={18} />}{data.isDir && <Icon name="folder" size={16} />}{data.isLlm && <Icon name="chat" size={16} />}{data.isPy && <Icon name="code_run" size={16} />}{data.label}</div>
      <div className="subtitle">{data.sub || ' '}</div>
      {(!data.isTool || data.isInput) && <Handle type="source" position={Position.Right} className="port" />}
      {!data.isTool && data.kind !== 'orchestrator' && <Handle id={CALL_OUT} type="source" position={Position.Bottom} className="port call" title="呼ぶ側（呼ばれる担当へワイヤーをつなぐ）" />}
    </div>
  );
}
const nodeTypes = { neko: NekoNode };

function Inner({ entities, tools, fitKey, selected, onSelect, onMove, onConnect, onContext }: {
  entities: Entity[]; tools: Tool[]; fitKey: number; selected: Sel; onSelect: (s: Sel) => void;
  onMove: (id: string, x: number, y: number) => void; onConnect: (from: string, to: string, handles?: { source?: string | null; target?: string | null }) => void; onContext: (c: CtxTarget) => void;
}) {
  const rf = useReactFlow();
  const g = useMemo(() => buildGraph(entities, tools), [entities, tools]);
  const built: Node<NodeData>[] = useMemo(() => g.nodes.map((n: GraphNode) => ({
    id: n.id, type: 'neko', position: { x: n.x, y: n.y }, selected: selected?.type === 'node' && selected.id === n.id,
    data: { label: n.label, sub: n.sub, kind: n.type === 'tool' ? 'tool' : n.kind, protected: n.protected, isTool: n.type === 'tool', isDir: n.kind === 'directory', isLlm: n.kind === 'llm', isPy: n.kind === 'python', isInput: n.kind === 'input', icon: n.icon || null },
  })), [g, selected]);
  // ドラッグ中の位置は、ここで持つ（制御コンポーネントは onNodesChange で位置を反映しないと動かない）。台帳が変わったら作り直す
  const [nodes, setNodes] = useState<Node<NodeData>[]>(built);
  useEffect(() => setNodes(built), [built]);
  const onNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => setNodes((ns) => applyNodeChanges(changes, ns)), []);
  const edges: Edge[] = useMemo(() => g.edges.map((e) => ({
    id: e.id, source: e.from, target: e.to, ...(e.type === 'call' ? { sourceHandle: CALL_OUT, targetHandle: CALL_IN } : {}), className: `edge ${e.type}`, selected: selected?.type === 'edge' && selected.id === e.id,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }, style: e.type === 'tool' ? { strokeDasharray: '6 4' } : e.type === 'input' ? { strokeDasharray: '2 4' } : e.type === 'call' ? { strokeDasharray: '10 3 2 3' } : undefined,
  })), [g, selected]);

  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.15, duration: 200 }), 50); return () => clearTimeout(t); }, [fitKey, rf]);

  const isValid = useCallback((c: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) => canConnect(entities, tools, c.source, c.target, { source: c.sourceHandle, target: c.targetHandle }).ok, [entities, tools]);
  const connect: OnConnect = useCallback((c) => { if (c.source && c.target) onConnect(c.source, c.target, { source: c.sourceHandle, target: c.targetHandle }); }, [onConnect]);
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
