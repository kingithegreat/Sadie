import React from "react";
import { useEffect, useState } from "react";
import { ipcRenderer } from "electron";
import "../styles/global.css";

// Modern Apple-style traffic-light TitleBar for SADIE
// Uses theme tokens, accessibility, animation, and IPC hooks

const isMac = navigator.userAgent.includes("Macintosh") || navigator.userAgent.includes("Mac OS X");

export const TitleBar: React.FC = () => {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    // Listen for drag events from main process (optional, for animated feedback)
    ipcRenderer.on("window-drag", (_event, dragging: boolean) => {
      setIsDragging(dragging);
    });
    return () => {
      ipcRenderer.removeAllListeners("window-drag");
    };
  }, []);

  // Window controls
  const handleMinimize = () => ipcRenderer.invoke("window:minimize");
  const handleMaximize = () => ipcRenderer.invoke("window:maximize");
  const handleClose = () => ipcRenderer.invoke("window:close");

  return (
    <header
      className={`sadie-titlebar${isDragging ? " sadie-titlebar--dragging" : ""}`}
      role="banner"
      aria-label="Window Title Bar"
      tabIndex={-1}
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="sadie-titlebar__controls" aria-label="Window Controls">
        {/* macOS traffic lights */}
        <button
          className="sadie-titlebar__btn sadie-titlebar__btn--close"
          aria-label="Close window"
          tabIndex={0}
          onClick={handleClose}
        >
          <span className="sadie-titlebar__icon sadie-titlebar__icon--close" />
        </button>
        <button
          className="sadie-titlebar__btn sadie-titlebar__btn--minimize"
          aria-label="Minimize window"
          tabIndex={0}
          onClick={handleMinimize}
        >
          <span className="sadie-titlebar__icon sadie-titlebar__icon--minimize" />
        </button>
        <button
          className="sadie-titlebar__btn sadie-titlebar__btn--maximize"
          aria-label="Maximize window"
          tabIndex={0}
          onClick={handleMaximize}
        >
          <span className="sadie-titlebar__icon sadie-titlebar__icon--maximize" />
        </button>
      </div>
      <div className="sadie-titlebar__title" aria-label="App Title">
        SADIE
      </div>
      {/* Optionally add status or actions here */}
    </header>
  );
};

export default TitleBar;

/*
Add to global.css or themes.css:

.sadie-titlebar {
  display: flex;
  align-items: center;
  height: 32px;
  background: var(--sadie-titlebar-bg, #f8f8fa);
  color: var(--sadie-titlebar-fg, #222);
  box-shadow: var(--sadie-titlebar-shadow, 0 1px 8px rgba(0,0,0,0.04));
  padding: 0 12px;
  user-select: none;
  transition: background 0.2s, box-shadow 0.2s;
}
.sadie-titlebar--dragging {
  background: var(--sadie-titlebar-bg-drag, #e0e0e7);
  box-shadow: var(--sadie-titlebar-shadow-drag, 0 2px 16px rgba(0,0,0,0.10));
}
.sadie-titlebar__controls {
  display: flex;
  gap: 8px;
  margin-right: 12px;
}
.sadie-titlebar__btn {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  background: transparent;
  position: relative;
  padding: 0;
  cursor: pointer;
  transition: box-shadow 0.2s;
  outline: none;
}
.sadie-titlebar__btn:focus-visible {
  box-shadow: 0 0 0 2px var(--sadie-focus-ring, #007aff);
}
.sadie-titlebar__btn--close .sadie-titlebar__icon {
  background: #ff5f57;
}
.sadie-titlebar__btn--minimize .sadie-titlebar__icon {
  background: #febc2e;
}
.sadie-titlebar__btn--maximize .sadie-titlebar__icon {
  background: #28c940;
}
.sadie-titlebar__icon {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.08);
}
.sadie-titlebar__title {
  flex: 1;
  text-align: center;
  font-weight: 500;
  font-size: 15px;
  letter-spacing: 0.02em;
  color: var(--sadie-titlebar-fg, #222);
  pointer-events: none;
  user-select: none;
}
*/
