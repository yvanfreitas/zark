import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import { playbackFrames } from '@core/flow-text';
import { App } from './App';
import { Canvas } from './canvas/Canvas';
import { useStore } from './store';
import { tr } from './i18n';
import { renderRoute } from './route';

/**
 * Panel-less route the renderer screenshots: /render/drawing/<id> or
 * /render/flow/<id>[?step=<id>]. Same canvas component, no animation.
 */
function RenderView({ kind, id }: { kind: 'drawing' | 'flow'; id: string }) {
  const model = useStore((s) => s.model);
  const loadError = useStore((s) => s.loadError);
  const drawingId = useStore((s) => s.drawingId);
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    // PNGs are committed artifacts: the render route always draws in English.
    useStore.getState().set({ lang: 'en' });
    void useStore.getState().load().then(() => {
      const s = useStore.getState();
      if (!s.model) return;
      if (kind === 'drawing') {
        if (!s.model.drawings.some((d) => d.id === id)) return s.set({ loadError: tr('render.noDrawing', { id }) });
        return s.set({ drawingId: id, flow: null });
      }
      const flow = s.model.flows.find((f) => f.id === id);
      if (!flow) return s.set({ loadError: tr('render.noFlow', { id }) });
      const step = params.get('step');
      const frames = playbackFrames(flow.steps, {}, (fid) => s.model!.flows.find((f) => f.id === fid)?.steps);
      const frame = step ? frames.findIndex((fr) => fr.some((x) => x.id === step)) : -1;
      if (step && frame < 0) return s.set({ loadError: tr('render.noStep', { step, id }) });
      s.set({ drawingId: flow.drawing, flow: { id, frame, playing: false, speed: 1, choice: {} } });
    });
  }, [kind, id]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  if (loadError) return <div data-ready="true" data-error={loadError} />;
  if (!model || !drawingId) return null;
  return (
    <ReactFlowProvider>
      <Canvas mode="render" />
    </ReactFlowProvider>
  );
}

const match = renderRoute(location.pathname);
createRoot(document.getElementById('root')!).render(
  <StrictMode>{match ? <RenderView kind={match.kind} id={match.id} /> : <App />}</StrictMode>,
);
