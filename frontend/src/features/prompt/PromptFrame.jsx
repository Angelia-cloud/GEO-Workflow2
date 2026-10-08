import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import promptFlowCss from "./prompt-flow.css?inline";
import { PromptFlow } from "./PromptFlow";

/**
 * Hosts the Prompt wizard in its own document. The wizard's stylesheet was written for a
 * standalone page (its own :root variables, body styles and viewport-relative layout), so it
 * renders inside a same-origin frame with a separate React root. Props flow straight through –
 * there is no message passing.
 */
export function PromptFrame({ hidden, ...props }) {
  const frameRef = useRef(null);
  const rootRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    const doc = frame.contentDocument;
    doc.open();
    doc.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Komosion — Prompt</title></head><body></body></html>');
    doc.close();
    const style = doc.createElement("style");
    style.textContent = promptFlowCss;
    doc.head.appendChild(style);
    const container = doc.createElement("div");
    container.id = "prompt-root";
    doc.body.appendChild(container);
    rootRef.current = createRoot(container);
    setReady(true);
    return () => {
      const root = rootRef.current;
      rootRef.current = null;
      setTimeout(() => root?.unmount(), 0);
    };
  }, []);

  useLayoutEffect(() => {
    if (ready) rootRef.current?.render(<PromptFlow {...props} />);
  });

  return <iframe ref={frameRef} title="Phase 1: Prompt" className="guided-phase-frame" hidden={hidden} />;
}
